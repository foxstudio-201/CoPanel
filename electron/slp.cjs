
const net = require('node:net')
const dns = require('node:dns')

const SLP_TIMEOUT_MS = 5000
const SLP_MAX_BYTES = 4 * 1024 * 1024
const SRV_TIMEOUT_MS = 1500
const SRV_NAME = '_minecraft._tcp.'

const isIpLiteral = (h) => /^[\d.]+$/.test(h) || h.includes(':')

async function resolveSrv(host, lookup, timeoutMs = SRV_TIMEOUT_MS) {
  const query = Promise.resolve()
    .then(() => lookup(`${SRV_NAME}${host}`))
    .then((rows) => {
      const best = (Array.isArray(rows) ? [...rows] : []).sort(
        (a, b) =>
          (Number(a?.priority) || 0) - (Number(b?.priority) || 0) ||
          (Number(b?.weight) || 0) - (Number(a?.weight) || 0),
      )[0]
      const target = String(best?.name || '').replace(/\.$/, '')
      const port = Number(best?.port)
      if (!target || !Number.isFinite(port) || port <= 0 || port > 65535) return null
      return { host: target, port }
    })
    .catch(() => null)
  return Promise.race([query, new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))])
}

function writeVarInt(value) {
  let v = value | 0
  const bytes = []
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    bytes.push(byte)
  } while (v !== 0)
  return Buffer.from(bytes)
}

function readVarInt(buf, offset) {
  let result = 0
  let shift = 0
  let pos = offset
  for (;;) {
    if (pos >= buf.length) return null 
    const byte = buf[pos++]
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 35) return null
  }
  return { value: result >>> 0, size: pos - offset }
}

function packString(str) {
  const body = Buffer.from(String(str), 'utf8')
  return Buffer.concat([writeVarInt(body.length), body])
}

function stripFormatting(text) {
  return String(text || '').replace(/\u00a7./g, '').trim()
}

function motdText(desc) {
  if (!desc) return ''
  if (typeof desc === 'string') return stripFormatting(desc)
  const walk = (node) => {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object') return ''
    let out = typeof node.text === 'string' ? node.text : ''
    if (Array.isArray(node.extra)) out += node.extra.map(walk).join('')
    return out
  }
  const root = Array.isArray(desc) ? desc.map(walk).join('') : walk(desc)
  return stripFormatting(root)
}

function tryParseStatus(buf) {
  const len = readVarInt(buf, 0)
  if (!len || len.value <= 0 || len.value > SLP_MAX_BYTES) return null
  const body = buf.subarray(len.size, len.size + len.value)
  if (body.length < len.value) return null
  const pid = readVarInt(body, 0)
  if (!pid || pid.value !== 0) return null
  const strLen = readVarInt(body, pid.size)
  if (!strLen) return null
  const start = pid.size + strLen.size
  const raw = body.subarray(start, start + strLen.value)
  if (raw.length < strLen.value) return null
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    return null
  }
}

function connectStatus(host, port, timeout) {
  return new Promise((resolve) => {
    const h = String(host || '').trim()
    const p = Number(port)
    if (!h || !Number.isFinite(p) || p <= 0 || p > 65535) {
      resolve({ ok: false, error: 'invalid-host' })
      return
    }
    const startedAt = Date.now()
    const chunks = []
    let total = 0
    let settled = false

    const socket = new net.Socket()
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      try { socket.destroy() } catch {}
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeout)

    socket.setNoDelay(true)
    socket.on('error', (err) => finish({ ok: false, error: err?.code || err?.message || 'socket-error' }))
    socket.on('close', () => finish({ ok: false, error: 'closed' }))
    socket.on('data', (buf) => {
      chunks.push(buf)
      total += buf.length
      if (total > SLP_MAX_BYTES) {
        finish({ ok: false, error: 'response-too-large' })
        return
      }
      const status = tryParseStatus(Buffer.concat(chunks))
      if (!status) return
      const players = status.players || {}
      finish({
        ok: true,
        latencyMs: Date.now() - startedAt,
        version: status.version?.name ? String(status.version.name) : '',
        protocol: Number(status.version?.protocol) || 0,
        online: Number(players.online) || 0,
        max: Number(players.max) || 0,
        sample: Array.isArray(players.sample)
          ? players.sample
              .filter((s) => s && s.name)
              .map((s) => ({ name: String(s.name), id: String(s.id || '') }))
          : [],
        motd: motdText(status.description),
      })
    })

    socket.connect(p, h, () => {
      const handshake = Buffer.concat([
        writeVarInt(0x00),
        writeVarInt(-1),
        packString(h),
        Buffer.from([(p >> 8) & 0xff, p & 0xff]),
        writeVarInt(1),
      ])
      socket.write(Buffer.concat([writeVarInt(handshake.length), handshake, Buffer.from([0x01, 0x00])]))
    })
  })
}

async function mcStatusPing({ host, port, timeoutMs, srv, lookupSrv } = {}) {
  const h = String(host || '').trim()
  const p = Number(port)
  if (!h || !Number.isFinite(p) || p <= 0 || p > 65535) return { ok: false, error: 'invalid-host' }
  const timeout = Math.min(Math.max(Number(timeoutMs) || SLP_TIMEOUT_MS, 1000), 15000)

  if (srv && !isIpLiteral(h)) {
    const lookup = typeof lookupSrv === 'function' ? lookupSrv : (name) => dns.promises.resolveSrv(name)
    const redirect = await resolveSrv(h, lookup)
    const sameAsPlain = redirect && redirect.host.toLowerCase() === h.toLowerCase() && redirect.port === p
    if (redirect && !sameAsPlain) {
      const viaSrv = await connectStatus(redirect.host, redirect.port, timeout)
      if (viaSrv.ok) return { ...viaSrv, srv: redirect }
    }
  }
  return connectStatus(h, p, timeout)
}

module.exports = { mcStatusPing, resolveSrv, writeVarInt, readVarInt, packString, motdText, stripFormatting }
