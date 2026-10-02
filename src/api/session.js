
import { getSession, setSession, resetSession, emitTps } from './store.js'
import * as api from './client.js'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI


export function normalizeUrl(raw) {
  let value = String(raw || '').trim()
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol)) return ''
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

async function persist() {
  const s = getSession()
  if (!isElectron || s.demo) return
  await window.electronAPI.saveSettings({
    panel: {
      panelType: s.panelType,
      url: s.url,
      account: s.account,
    },
  })
  await window.electronAPI.setSecret('panelApiKey', s.apiKey)
}

async function forgetSecrets() {
  if (!isElectron || getSession().demo) return
  await window.electronAPI.setSecret('panelApiKey', '')
}

function describeKeyProblem(err) {
  const status = err?.status
  if (status === 401 || status === 403 || status === 404) {
    return (
      'That key could not access the Client API. Use a Client API key ' +
      '(starts with ptlc_) created under Account → API Credentials. ' +
      'An Application key (ptla_) cannot open consoles or control servers.'
    )
  }
  if (status === 0) return err?.message || 'Could not reach the panel. Check the URL.'
  return err?.message || 'Connection failed.'
}


export function detectPanelType(apiKey) {
  const key = String(apiKey || '').trim()
  if (/^c7sp_/i.test(key)) return 'calagopus'
  if (/^ptlc_/i.test(key)) return 'pterodactyl'
  return ''
}


export async function connectWithApiKey({ panelType, url, apiKey }) {
  const origin = normalizeUrl(url)
  if (!origin) return { ok: false, error: 'Enter a valid panel URL, e.g. https://panel.example.com' }
  const key = String(apiKey || '').trim()
  if (!key) return { ok: false, error: 'API key is required.' }
  if (/^ptla_/i.test(key)) {
    return {
      ok: false,
      error:
        'This is an Application API key (ptla_). Application keys list servers but cannot read consoles ' +
        'or send power actions. Create a Client API key at Account → API Credentials (starts with ptlc_).',
    }
  }
  const type = panelType || detectPanelType(key)
  if (!type) {
    return {
      ok: false,
      error:
        'Could not recognise the panel from this key. Pterodactyl client keys start with ptlc_, ' +
        'Calagopus keys start with c7sp_.',
    }
  }

  setSession({ status: 'connecting', panelType: type, url: origin, apiKey: key, error: '' })

  try {
    const account = await api.getAccount()
    setSession({
      status: 'connected',
      account: {
        id: account?.id ?? null,
        uuid: account?.uuid || '',
        username: account?.username || account?.email?.split('@')[0] || '',
        email: account?.email || '',
        root_admin: !!account?.root_admin,
        image: account?.image || '',
      },
      error: '',
    })
    await persist()
    return { ok: true, account: getSession().account }
  } catch (err) {
    const message = describeKeyProblem(err)
    setSession({ status: 'disconnected', error: message })
    await forgetSecrets()
    return { ok: false, error: message }
  }
}


export async function startDemo(panelType = 'pterodactyl') {
  setSession({
    status: 'connected',
    panelType,
    url: 'https://demo.copanel.local',
    apiKey: 'demo',
    demo: true,
    account: { id: 1, uuid: 'demo-account-uuid', username: 'demo', email: 'demo@copanel.local', root_admin: true, image: '' },
    error: '',
  })
  return { ok: true, account: getSession().account }
}


export async function restoreConnection(expectedType) {
  if (!isElectron) return { ok: false }

  const settings = await window.electronAPI.getSettings()
  const panel = settings?.panel
  if (!panel?.url || !panel?.panelType) return { ok: false }
  if (expectedType && panel.panelType !== expectedType) return { ok: false, reason: 'type-mismatch' }

  const apiKey = await window.electronAPI.getSecret('panelApiKey')
  if (!apiKey) return { ok: false }

  setSession({
    status: 'connecting',
    panelType: panel.panelType,
    url: panel.url,
    apiKey,
    account: panel.account || null,
    error: '',
  })
  try {
    const account = await api.getAccount()
    setSession({
      status: 'connected',
      account: {
        id: account?.id ?? null,
        uuid: account?.uuid || '',
        username: account?.username || account?.email?.split('@')[0] || '',
        email: account?.email || '',
        root_admin: !!account?.root_admin,
        image: account?.image || '',
      },
    })
    return { ok: true }
  } catch (err) {
    resetSession({ panelType: panel.panelType, error: describeKeyProblem(err) })
    await forgetSecrets()
    return { ok: false, error: describeKeyProblem(err) }
  }
}

export async function disconnect({ forget = true } = {}) {
  const ids = consoleSubscribers.keys()
  for (const id of [...ids]) await closeConsole(id)
  if (getSession().demo) {
    resetSession()
    return
  }
  if (forget) await forgetSecrets()
  if (isElectron) {
    const settings = await window.electronAPI.getSettings()
    await window.electronAPI.saveSettings({ ...settings, panel: undefined })
  }
  resetSession()
}

const consoleSubscribers = new Map() 
let wsListenerBound = false

function ensureWsListener() {
  if (wsListenerBound || !isElectron || !window.electronAPI.onWsEvent) return
  wsListenerBound = true
  window.electronAPI.onWsEvent(({ id, event, args }) => {
    if (event === 'console output' || event === 'install logs' || event === 'transfer logs') {
      const text = Array.isArray(args) ? args.join('\n') : String(args ?? '')
      const tps = extractTps(text)
      if (tps != null) emitTps(tps)
    }
    const subs = consoleSubscribers.get(id)
    if (!subs) return
    subs.forEach((fn) => {
      try {
        fn({ id, event, args })
      } catch (err) {
        console.error('[copanel] console listener failed', err)
      }
    })
  })
}


const TPS_PATTERNS = [
  { re: /mean\s+tps\s*[:=]\s*([\d.]+)/i, kind: 'tps' },
  { re: /\bTPS\s+from\s+last[^:]*:\s*([\d.]+)/i, kind: 'tps' },
  { re: /\b(?:avg|average)\s+TPS\s*[:=]?\s*([\d.]+)/i, kind: 'tps' },
  { re: /\bTPS\s*[:=]\s*([\d.]+)/i, kind: 'tps' },
  { re: /\btick\s+rate\s*[:=]\s*([\d.]+)/i, kind: 'tps' },
  { re: /\bMSPT\s*[:=]?\s*([\d.]+)/i, kind: 'mspt' },
  { re: /mean\s+(?:tick|server tick)\s+time\s*[:=]\s*([\d.]+)/i, kind: 'mspt' },
  { re: /average\s+time\s+per\s+tick\s*[:=]?\s*([\d.]+)\s*ms/i, kind: 'mspt' },
]

export function extractTps(text) {
  const s = String(text ?? '')
  if (!s) return null
  for (const { re, kind } of TPS_PATTERNS) {
    const m = s.match(re)
    if (!m) continue
    const n = Number(m[1])
    if (!Number.isFinite(n) || n <= 0) continue
    if (kind === 'mspt') {
      return Math.max(0, Math.min(20, 1000 / Math.max(n, 0.0001)))
    }
    return Math.max(0, Math.min(20, n))
  }
  return null
}


const demoTimers = new Map()
const demoEmit = (identifier, payload) => {
  const subs = consoleSubscribers.get(identifier)
  if (subs) subs.forEach((fn) => { try { fn(payload) } catch {  } })
}

export async function openConsole(identifier, onEvent) {
  ensureWsListener()
  if (!isElectron || !identifier) return { ok: false, error: 'Console requires the desktop build.' }

  if (getSession().demo) {
    if (onEvent) {
      if (!consoleSubscribers.has(identifier)) consoleSubscribers.set(identifier, new Set())
      consoleSubscribers.get(identifier).add(onEvent)
    }
    if (!demoTimers.has(identifier)) {
      const { demoConsoleLines } = await import('./demo.js')
      setTimeout(() => demoEmit(identifier, { id: identifier, event: 'auth success', args: [] }), 150)
      const warm = Array.from({ length: 7 }, () => demoConsoleLines()).join('\n')
      setTimeout(() => demoEmit(identifier, { id: identifier, event: 'console output', args: [warm] }), 220)
      demoTimers.set(
        identifier,
        setInterval(() => demoEmit(identifier, { id: identifier, event: 'console output', args: [demoConsoleLines()] }), 1400),
      )
    }
    return { ok: true }
  }

  if (onEvent) {
    if (!consoleSubscribers.has(identifier)) consoleSubscribers.set(identifier, new Set())
    consoleSubscribers.get(identifier).add(onEvent)
  }

  const creds = await api.getWebsocketCredentials(identifier)
  if (!creds?.token || !creds?.socket) return { ok: false, error: 'The panel did not return websocket credentials.' }

  const origin = getSession().url
  const auth = { mode: 'apikey', key: getSession().apiKey }

  const result = await window.electronAPI.wsConnect({
    id: identifier,
    wsUrl: creds.socket,
    token: creds.token,
    tokenUrl: `${origin}/api/client/servers/${identifier}/websocket`,
    auth,
    origin, 
  })
  if (!result?.ok) return { ok: false, error: result?.error || 'WebSocket connection failed.' }
  return { ok: true }
}

export function closeConsole(identifier) {
  const timer = demoTimers.get(identifier)
  if (timer) {
    clearInterval(timer)
    demoTimers.delete(identifier)
  }
  consoleSubscribers.delete(identifier)
  if (isElectron && identifier) return window.electronAPI.wsDisconnect({ id: identifier })
  return Promise.resolve({ ok: true })
}

export function sendConsole(identifier, event, args = []) {
  if (!isElectron) return Promise.resolve({ ok: false, error: 'Desktop build required.' })
  return window.electronAPI.wsSend({ id: identifier, event, args })
}

export function consoleStatus(identifier) {
  if (!isElectron) return Promise.resolve({ ok: false, connected: false })
  return window.electronAPI.wsStatus({ id: identifier })
}
