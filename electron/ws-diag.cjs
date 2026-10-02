
function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

function describeWsError(event, origin) {
  const raw =
    event?.error?.message ||
    event?.message ||
    (event?.error ? String(event.error) : '') ||
    ''
  const s = String(raw).trim()

  if (/unexpected server response:\s*403/i.test(s)) {
    return `WebSocket refused by the node (HTTP 403): Origin "${origin}" is not the panel URL configured in Wings. Fix one of: (1) enter the panel exactly as APP_URL, or (2) add this origin to Wings \`allowed_origins\` in /etc/pterodactyl/config.yml and restart wings.`
  }
  if (/unexpected server response:\s*(\d+)/i.test(s)) {
    return `Node rejected the websocket upgrade (HTTP ${RegExp.$1}).`
  }
  if (/certificate|self.signed|Hostname\/IP does not match|unable to verify/i.test(s)) {
    return `TLS error reaching the node (${s}) — its certificate is not trusted by this machine.`
  }
  if (/ECONNREFUSED/i.test(s)) return 'Connection refused by the node (port closed or wings not running).'
  if (/ENOTFOUND|EAI_AGAIN/i.test(s)) return `Cannot resolve the node host (${s}).`
  if (/ETIMEDOUT|timed? ?out/i.test(s)) return 'Timed out reaching the node — check firewall / port 2083.'
  return s ? `WebSocket error: ${s}` : ''
}

function probeWsUpgrade(wsUrl, origin) {
  return new Promise((resolve) => {
    let u
    try {
      u = new URL(wsUrl)
    } catch {
      return resolve('invalid websocket URL')
    }
    const secure = u.protocol === 'wss:'
    const lib = require(secure ? 'node:https' : 'node:http')
    const key = require('node:crypto').randomBytes(16).toString('base64')
    let settled = false
    const finish = (v) => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (secure ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: {
          Origin: origin,
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
        },
        timeout: 6000,
      },
      (res) => {
        finish(`HTTP ${res.statusCode}`)
        res.resume()
      },
    )
    req.on('upgrade', (_res, socket) => {
      finish('HTTP 101')
      socket.destroy()
      req.destroy()
    })
    req.on('timeout', () => {
      req.destroy()
      finish('timeout after 6s')
    })
    req.on('error', (err) => finish(err?.message || 'probe failed'))
    req.end()
  })
}

function wsFailureMessage(status, origin, fallback) {
  const s = String(status)
  if (s === 'HTTP 403') {
    return `Wings rejected the connection because Origin "${origin}" is not allowed. Fix: enter the panel URL exactly as its APP_URL in CoPanel, or add "${origin}" to \`allowed_origins\` in /etc/pterodactyl/config.yml and restart wings.`
  }
  if (s === 'HTTP 101') {
    return fallback || 'The node accepted the handshake but the socket dropped right after.'
  }
  if (s === 'HTTP 404') {
    return 'The node has no websocket route (HTTP 404) — Wings may be outdated, or this is the panel URL rather than the node.'
  }
  if (s === 'HTTP 400') {
    return 'The node answered HTTP 400 — it is reachable but refused the websocket upgrade.'
  }
  if (/certificate|self.signed|unable to verify|Hostname\/IP/i.test(s)) {
    return `TLS problem reaching the node: ${s}. Its certificate is not trusted by this machine.`
  }
  if (/ECONNREFUSED/i.test(s)) return `The node refused the connection: ${s} (wings down or port closed).`
  if (/ENOTFOUND|EAI_AGAIN/i.test(s)) return `Cannot resolve the node host: ${s}`
  if (/timeout/i.test(s)) return `Timed out reaching the node (${s}) — check firewall / websocket port.`
  return fallback || `Console socket failed (${s}).`
}

module.exports = { originOf, describeWsError, probeWsUpgrade, wsFailureMessage }
