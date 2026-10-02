
import * as api from './client.js'
import { getSession } from './store.js'
import * as nbt from '../lib/nbt.js'


const NAME_RE = /^[A-Za-z0-9_]{1,16}$/

const quiet = (promise, fallback) => promise.catch(() => fallback)


export const uuidKey = (u) => {
  const k = String(u || '')
    .toLowerCase()
    .replace(/-/g, '')
  return /^0+$/.test(k) ? '' : k
}

const isZeroUuid = (u) => !uuidKey(u) && !!String(u || '').trim()


export function parseProperties(text) {
  const out = new Map()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#') || s.startsWith('!')) continue
    const i = s.indexOf('=')
    if (i < 1) continue
    out.set(s.slice(0, i).trim(), s.slice(i + 1).trim())
  }
  return out
}

async function readJson(id, path) {
  return JSON.parse(await api.readFile(id, path))
}


export function headUrl(uuidOrName, size = 96) {
  const key = String(uuidOrName || '').trim()
  if (!key) return ''
  return `https://mc-heads.net/avatar/${encodeURIComponent(key)}/${size}`
}


export async function loadServerMeta(id) {
  const props = await quiet(api.readFile(id, '/server.properties').then(parseProperties), new Map())
  const world = props.get('level-name') || 'world'
  const max = Number(props.get('max-players'))
  return { world, maxPlayers: Number.isFinite(max) && max > 0 ? max : null }
}


export async function loadPlayers(id) {
  const { world, maxPlayers } = await loadServerMeta(id)
  const [dataDir, statDir, advDir, cache, ops, white, bans] = await Promise.all([
    quiet(api.listFiles(id, `/${world}/playerdata`), []),
    quiet(api.listFiles(id, `/${world}/stats`), []),
    quiet(api.listFiles(id, `/${world}/advancements`), []),
    quiet(readJson(id, '/usercache.json'), []),
    quiet(readJson(id, '/ops.json'), []),
    quiet(readJson(id, '/whitelist.json'), []),
    quiet(readJson(id, '/banned-players.json'), []),
  ])

  const rows = new Map()
  const get = (uuid, name) => {
    const key = uuidKey(uuid) || `name:${String(name || '').toLowerCase()}`
    let p = rows.get(key)
    if (!p) {
      p = {
        uuid: '',
        name: '',
        hasData: false,
        dataFile: '',
        dataOldFile: '',
        statsFile: '',
        advFile: '',
        lastSeen: 0,
        op: false,
        opLevel: 0,
        whitelisted: false,
        banned: false,
        banReason: '',
      }
      rows.set(key, p)
    }
    if (uuid && !p.uuid && !isZeroUuid(uuid)) p.uuid = String(uuid)
    if (name && !p.name) p.name = String(name)
    return p
  }

  for (const f of dataDir) {
    if (!f?.is_file) continue
    const n = String(f.name || '')
    if (/\.dat$/i.test(n)) {
      const p = get(n.slice(0, -4))
      p.hasData = true
      p.dataFile = n
    } else if (/\.dat_old$/i.test(n)) {
      get(n.slice(0, -8)).dataOldFile = n
    }
  }
  for (const f of statDir) if (f?.is_file && /\.json$/i.test(f.name || '')) get(String(f.name).slice(0, -5)).statsFile = f.name
  for (const f of advDir) if (f?.is_file && /\.json$/i.test(f.name || '')) get(String(f.name).slice(0, -5)).advFile = f.name

  for (const row of Array.isArray(cache) ? cache : []) {
    if (!row?.uuid) continue
    const p = get(row.uuid, row.name)
    const at = row.expiresOn ? Date.parse(row.expiresOn) : NaN
    if (Number.isFinite(at)) p.lastSeen = Math.max(p.lastSeen, at)
  }
  for (const row of Array.isArray(ops) ? ops : []) {
    if (!row?.uuid) continue
    const p = get(row.uuid, row.name)
    p.op = true
    p.opLevel = Number(row.level) || 0
  }
  for (const row of Array.isArray(white) ? white : []) {
    if (!row?.uuid) continue
    get(row.uuid, row.name).whitelisted = true
  }
  for (const row of Array.isArray(bans) ? bans : []) {
    if (!row) continue
    const p = get(row.uuid, row.name)
    p.banned = true
    p.banReason = String(row.reason || '')
  }

  const players = mergeByName([...rows.values()]).sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1
    return (a.name || a.uuid).toLowerCase().localeCompare((b.name || b.uuid).toLowerCase())
  })
  return { world, maxPlayers, players }
}


function mergeByName(rows) {
  const groups = new Map()
  for (const p of rows) {
    const key = String(p.name || '').toLowerCase()
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  const emitted = new Set()
  const out = []
  for (const p of rows) {
    if (emitted.has(p)) continue
    const group = p.name ? groups.get(String(p.name).toLowerCase()) : null
    const target = group && group.length > 1 ? group.find((x) => x.uuid) || p : p
    if (group && group.length > 1) {
      for (const other of group) {
        if (other === target || emitted.has(other)) continue
        target.hasData = target.hasData || other.hasData
        target.dataFile = target.dataFile || other.dataFile
        target.dataOldFile = target.dataOldFile || other.dataOldFile
        target.statsFile = target.statsFile || other.statsFile
        target.advFile = target.advFile || other.advFile
        target.lastSeen = Math.max(target.lastSeen, other.lastSeen)
        target.op = target.op || other.op
        target.opLevel = Math.max(target.opLevel, other.opLevel)
        target.whitelisted = target.whitelisted || other.whitelisted
        target.banned = target.banned || other.banned
        target.banReason = target.banReason || other.banReason
        if (!target.uuid) target.uuid = other.uuid
        emitted.add(other)
      }
    }
    emitted.add(target)
    out.push(target)
  }
  return out
}


export async function deletePlayer(id, world, player, opts = {}) {
  const done = []
  const failed = []

  const fileJobs = []
  if (opts.data) {
    const names = [player.dataFile, player.dataOldFile].filter(Boolean)
    if (names.length) fileJobs.push(['playerdata', `/${world}/playerdata`, names])
  }
  if (opts.stats && player.statsFile) fileJobs.push(['stats', `/${world}/stats`, [player.statsFile]])
  if (opts.advancements && player.advFile) fileJobs.push(['advancements', `/${world}/advancements`, [player.advFile]])
  for (const [label, dir, names] of fileJobs) {
    try {
      await api.deleteFiles(id, dir, names)
      done.push(label)
    } catch {
      failed.push(label)
    }
  }

  const name = String(player.name || '')
  const commands = []
  if (NAME_RE.test(name)) {
    if (opts.whitelist && player.whitelisted) commands.push(['whitelist', `whitelist remove ${name}`])
    if (opts.op && player.op) commands.push(['op', `deop ${name}`])
    if (opts.unban && player.banned) commands.push(['unban', `pardon ${name}`])
  }
  for (const [label, cmd] of commands) {
    try {
      await api.sendCommand(id, cmd)
      done.push(label)
    } catch {
      failed.push(label)
    }
  }

  return { done, failed }
}



export function parseConsolePlayers(text) {
  const out = { list: null, joined: [], left: [] }
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const snapshot = line.match(/There are \d+ of a max of \d+ players online:?\s*(.*)$/i)
    if (snapshot) {
      out.list = snapshot[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => NAME_RE.test(s))
      continue
    }
    const joined = line.match(/\b([A-Za-z0-9_]{1,16}) joined the game\b/)
    if (joined) {
      out.joined.push(joined[1])
      continue
    }
    const left = line.match(/\b([A-Za-z0-9_]{1,16}) left the game\b/)
    if (left) out.left.push(left[1])
  }
  return out
}


export function buildPlayerCommand(kind, player, { reason = '', duration = '' } = {}) {
  const name = String(player?.name || '').trim()
  if (!NAME_RE.test(name)) return null
  const say = String(reason || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/^\//, '')
    .slice(0, 120)
  switch (kind) {
    case 'op':
      return `op ${name}`
    case 'deop':
      return `deop ${name}`
    case 'kick':
      return say ? `kick ${name} ${say}` : `kick ${name}`
    case 'ban': {
      const time = String(duration || '').trim()
      if (!time) return say ? `ban ${name} ${say}` : `ban ${name}`
      return say ? `tempban ${name} ${time} ${say}` : `tempban ${name} ${time}`
    }
    default:
      return null
  }
}


export const isBanDuration = (text) =>
  !String(text || '').trim() || /^\d{1,3}[smhdwmy]?(\d{1,3}[smhdwmy])*$/i.test(String(text).trim())

const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const PING_OK_TTL = 8000
const PING_FAIL_TTL = 5000
const MAX_PING_TARGETS = 6
const pingCache = new Map()

const usableHost = (value) => {
  const h = String(value || '').trim()
  if (!h) return ''
  return h === '0.0.0.0' || h === '::' || h === '*' ? '' : h
}

const isName = (h) => !/^[\d.]+$/.test(h) && !h.includes(':')

const overrideKey = (id) => `copanel.ping.${id}`


export function parsePingAddress(text) {
  const s = String(text || '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .trim()
  if (!s) return null
  let host = s
  let port = 25565
  const i = s.lastIndexOf(':')
  if (i > -1) {
    const tail = s.slice(i + 1)
    if (!/^\d+$/.test(tail)) return null
    host = s.slice(0, i)
    port = Number(tail)
  }
  if (!/^[A-Za-z0-9._-]+$/.test(host)) return null
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null
  return { host, port }
}


export function getPingOverride(id) {
  if (!id || typeof localStorage === 'undefined') return null
  try {
    return parsePingAddress(localStorage.getItem(overrideKey(id)) || '')
  } catch {
    return null
  }
}


export function setPingOverride(id, text) {
  if (!id || typeof localStorage === 'undefined') return null
  const clean = String(text || '').trim()
  try {
    if (clean) localStorage.setItem(overrideKey(id), clean)
    else localStorage.removeItem(overrideKey(id))
  } catch {
    return null
  }
  return parsePingAddress(clean)
}


export function serverPingTargets(server) {
  const override = getPingOverride(server?.id)
  if (override) return [{ ...override, via: 'manual', srv: isName(override.host) }]

  const out = []
  const add = (host, port, via) => {
    const h = usableHost(host)
    const p = Number(port)
    if (!h || !Number.isFinite(p) || p <= 0 || p > 65535) return
    if (out.length >= MAX_PING_TARGETS) return
    if (out.some((t) => t.host === h && t.port === p)) return
    out.push({ host: h, port: p, via, srv: isName(h) })
  }
  const allocations = Array.isArray(server?.allocations) ? server.allocations : []
  const primary = allocations.find((a) => a?.is_default) || allocations[0] || null
  add(primary?.ip_alias, primary?.port, 'allocation-alias')
  add(primary?.ip, primary?.port, 'allocation')
  add(server?.ipAlias, server?.port, 'allocation-alias')
  add(server?.ip, server?.port, 'allocation')
  for (const a of allocations) {
    add(a?.ip_alias, a?.port, 'allocation-alias')
    add(a?.ip, a?.port, 'allocation')
  }
  add(server?.sftp?.ip, server?.port, 'node-fqdn')
  try {
    add(new URL(getSession().url || '').hostname, server?.port, 'panel-host')
  } catch {}
  if (!out.length) add('127.0.0.1', server?.port || 25565, 'loopback')
  return out
}


export function serverPingTarget(server) {
  return serverPingTargets(server)[0] || null
}

const toValue = (raw, target) => ({
  ok: true,
  online: Number(raw.online) || 0,
  max: Number(raw.max) || 0,
  sample: Array.isArray(raw.sample) ? raw.sample : [],
  version: raw.version || '',
  motd: raw.motd || '',
  latencyMs: Number(raw.latencyMs) || 0,
  host: target.host,
  port: target.port,
  via: target.via,
  srv: raw.srv?.host ? `${raw.srv.host}:${raw.srv.port}` : '',
  at: Date.now(),
})


function racePing(targets) {
  return new Promise((resolve) => {
    let left = targets.length
    let done = false
    const errors = []
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    for (const target of targets) {
      let call
      try {
        call = window.electronAPI.mcPing({ host: target.host, port: target.port, srv: !!target.srv })
      } catch (err) {
        call = Promise.reject(err)
      }
      Promise.resolve(call).then(
        (raw) => {
          if (raw?.ok) {
            finish(toValue(raw, target))
            return
          }
          errors.push(`${target.via}=${raw?.error || 'ping-failed'}`)
          if (--left === 0) finish(failValue(errors, targets[0]))
        },
        (err) => {
          errors.push(`${target.via}=${err?.message || 'ping-failed'}`)
          if (--left === 0) finish(failValue(errors, targets[0]))
        },
      )
    }
  })
}

const failValue = (errors, first) => ({
  ok: false,
  error: [...new Set(errors)].slice(0, 3).join(', ') || 'ping-failed',
  ...first,
  at: Date.now(),
})


export async function pingServer(server, { force = false } = {}) {
  if (getSession().demo) {
    const { demoPing } = await import('./demo.js')
    return demoPing()
  }
  const targets = serverPingTargets(server)
  if (!targets.length) return { ok: false, error: 'no-allocation', at: Date.now() }
  if (!isElectron) return { ok: false, error: 'not-electron', ...targets[0], at: Date.now() }

  const key = targets.map((t) => `${t.host}:${t.port}`).join('|')
  const now = Date.now()
  const hit = pingCache.get(key)
  if (!force && hit && now - hit.at < (hit.value.ok ? PING_OK_TTL : PING_FAIL_TTL)) return hit.value

  const value = await racePing(targets)
  pingCache.set(key, { at: Date.now(), value })
  return value
}


export function invalidatePing(server) {
  const targets = serverPingTargets(server)
  pingCache.delete(targets.map((t) => `${t.host}:${t.port}`).join('|'))
}


export const SLOTS = {
  main: Array.from({ length: 36 }, (_, i) => i), 
  armor: [103, 102, 101, 100], 
  offhand: -106,
  ender: Array.from({ length: 27 }, (_, i) => i), 
}


export const itemLabel = (id) =>
  String(id || '')
    .replace(/^.*:/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())


export function itemTextureUrls(id, version = '1.21.4') {
  const name = String(id || '').replace(/^.*:/, '')
  if (!name) return []
  const base = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data'
  return [
    `${base}/${version}/items/${name}.png`,
    `${base}/${version}/blocks/${name}.png`,
    `https://static.minecraftitemids.com/64/${name}.png`,
  ]
}

const base64ToBytes = (b64) => {
  const bin = atob(String(b64 || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}


export async function loadInventory(id, world, player) {
  if (!player?.uuid) throw new Error('no-player-data')
  const file = `/${world}/playerdata/${player.dataFile || `${player.uuid}.dat`}`
  let model
  if (getSession().demo) {
    const { demoInventoryModel } = await import('./demo.js')
    model = demoInventoryModel(player.uuid)
  } else {
    if (!player?.dataFile) throw new Error('no-player-data')
    const url = await api.downloadFile(id, file)
    if (!url) throw new Error('The panel did not return a download URL.')

    const res = await window.electronAPI.panelDownload({ url, auth: { mode: 'none' } })
    if (!res?.ok) throw new Error(res?.error || 'Could not download the player file.')

    model = nbt.parseNbt(await nbt.gunzip(base64ToBytes(res.base64)))
  }
  const root = nbt.nbtCompound(model.root)
  const inv = root?.get('Inventory')
  const items = []
  for (const node of nbt.nbtList(inv) || []) {
    const c = nbt.nbtCompound(node)
    if (!c) continue
    items.push({
      slot: nbt.nbtNumber(c.get('Slot')) ?? 0,
      id: nbt.nbtString(c.get('id')) || '',
      count: nbt.nbtNumber(c.get('Count')) ?? 1,
      tag: c.get('tag') || null,
      node,
    })
  }
  const ender = root?.get('EnderItems') || null
  return { file, model, items, ender }
}


export const normalizeItemId = (raw) => {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_')
  if (!s) return ''
  const id = s.includes(':') ? s : `minecraft:${s}`
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) ? id : ''
}


export async function saveInventory(id, world, player, model) {
  const dir = `/${world}/playerdata`
  const file = player.dataFile || `${player.uuid}.dat`
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupName = `${file}.bak-${stamp}`
  const bytes = await nbt.gzipBytes(nbt.serializeNbt(model))
  if (getSession().demo) {
    const { demoStoreInventory } = await import('./demo.js')
    demoStoreInventory(player.uuid, model)
    return { backup: `${dir}/${backupName}`, bytes: bytes.length }
  }
  try {
    await api.copyFile(id, `${dir}/${file}`, `${dir}/${backupName}`)
  } catch (err) {
    throw new Error(`Không tạo được bản sao lưu (${err?.message || 'copy failed'}) - chưa ghi gì.`)
  }

  await api.uploadFile(id, dir, file, bytes)
  return { backup: `${dir}/${backupName}`, bytes: bytes.length }
}


export function setItem(model, { slot, id, count = 1 }) {
  const inv = ensureInventoryNode(model)
  const items = inv.items.filter((it) => nbt.nbtNumber(nbt.nbtCompound(it).get('Slot')) !== slot)
  items.push(
    nbt.nbtCompoundOf({
      Slot: nbt.nbtInt(slot),
      Count: nbt.nbtByte(Math.max(1, Math.min(127, Math.trunc(count) || 1))),
      id: nbt.nbtStr(id),
    }),
  )
  inv.items = items
  inv.itemType = nbt.TAG.Compound
  return true
}


export function clearSlot(model, slot) {
  const inv = ensureInventoryNode(model)
  inv.items = inv.items.filter((it) => nbt.nbtNumber(nbt.nbtCompound(it).get('Slot')) !== slot)
  return true
}


export function firstEmptySlot(model) {
  const used = new Set(itemsOf(model).map((i) => i.slot))
  for (const s of SLOTS.main) if (!used.has(s)) return s
  return null
}

const itemsOf = (model) => {
  const inv = nbt.nbtList(nbt.nbtCompound(model.root).get('Inventory'))
  const out = []
  for (const node of inv || []) {
    const c = nbt.nbtCompound(node)
    if (c) out.push({ slot: nbt.nbtNumber(c.get('Slot')) ?? 0 })
  }
  return out
}

function ensureInventoryNode(model) {
  const root = nbt.nbtCompound(model.root)
  let inv = root.get('Inventory')
  if (!inv || inv.type !== nbt.TAG.List) {
    inv = nbt.nbtListOf([], nbt.TAG.Compound)
    root.set('Inventory', { name: 'Inventory', ...inv })
  }
  return inv
}
