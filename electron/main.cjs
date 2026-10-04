
const { app, BrowserWindow, ipcMain, shell, clipboard, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { originOf, describeWsError, probeWsUpgrade, wsFailureMessage } = require('./ws-diag.cjs')
const { mcStatusPing } = require('./slp.cjs')
const updater = require('./updater.cjs')

const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let settingsCache = null

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings() {
  if (settingsCache) return settingsCache
  try {
    settingsCache = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}
  } catch {
    settingsCache = {}
  }
  return settingsCache
}

function writeSettings(next) {
  settingsCache = { ...readSettings(), ...next }
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 2), 'utf8')
  } catch (err) {
    console.error('[copanel] failed to persist settings', err)
  }
  return settingsCache
}

function encrypt(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { v: 1, enc: true, data: safeStorage.encryptString(value).toString('base64') }
    }
  } catch {}
  return { v: 1, enc: false, data: value }
}

function decrypt(stored) {
  if (!stored || typeof stored !== 'object' || typeof stored.data !== 'string') return ''
  try {
    if (stored.enc) return safeStorage.decryptString(Buffer.from(stored.data, 'base64'))
    return stored.data
  } catch {
    return ''
  }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function panelRequest(opts = {}) {
  const {
    url,
    method = 'GET',
    headers = {},
    body = undefined,
    bodyMode = 'json', 
    auth = { mode: 'none' }, 
    timeout = 30000,
    redirect = 'follow',
    bare = false, 
  } = opts

  if (!url) return { status: 0, ok: false, url: '', text: '', json: null, error: 'Missing URL' }

  const finalHeaders = bare
    ? { ...headers }
    : { Accept: 'application/vnd.pterodactyl.v1+json, application/json', ...headers }

  if (auth?.mode === 'apikey' && auth.key) {
    finalHeaders.Authorization = `Bearer ${auth.key}`
  }

  let payload
  if (body !== undefined && body !== null && bodyMode !== 'none') {
    if (bodyMode === 'json') {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json'
      payload = typeof body === 'string' ? body : JSON.stringify(body)
    } else if (bodyMode === 'text') {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'text/plain; charset=utf-8'
      payload = String(body ?? '')
    } else if (bodyMode === 'form') {
      finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
      payload = body instanceof URLSearchParams ? body.toString() : String(body)
    } else if (bodyMode === 'binary') {
      payload = Buffer.isBuffer(body) ? body : Uint8Array.from(body)
    } else {
      payload = body
    }
  } else if (body !== undefined && body !== null) {
    payload = body
  }

  try {
    const res = await withTimeout(
      fetch(url, { method, headers: finalHeaders, body: payload, redirect }),
      timeout,
    )

    const text = await res.text().catch(() => '')
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }

    return {
      status: res.status,
      ok: res.ok,
      url: res.url,
      text,
      json,
      error: res.ok ? null : deriveHttpError(res.status, json, text),
    }
  } catch (err) {
    return { status: 0, ok: false, url, text: '', json: null, error: err?.message || 'Network error' }
  }
}

function deriveHttpError(status, json, text) {
  const errs = Array.isArray(json?.errors) ? json.errors : Array.isArray(json) ? json : null
  if (errs) {
    const messages = errs
      .map((e) => {
        if (typeof e === 'string') return e
        const msg = e?.message || e?.detail
        if (!msg) return ''
        const path = Array.isArray(e?.path) ? e.path.join('.') : ''
        return path ? `${path}: ${msg}` : String(msg)
      })
      .filter(Boolean)
    if (messages.length) return messages.join('\n')
  }
  const fromBody = json?.message || json?.error
  if (fromBody) return String(fromBody)
  if (status === 401) return 'Unauthorized: the API key is invalid or has expired.'
  if (status === 403) return 'Forbidden: this key does not have permission for that action.'
  if (status === 404) return 'Not found on the panel (404).'
  if (status === 429) return 'Rate limited by the panel (429). Try again shortly.'
  if (status >= 500) return `Panel returned a server error (${status}).`
  if (status === 0) return 'Could not reach the panel. Check the URL and your network.'
  const snippet = (text || '').replace(/\s+/g, ' ').slice(0, 160)
  return snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`
}

async function panelUpload({ url, directory, name, data }) {
  if (!url) return { ok: false, error: 'Missing upload URL.' }
  try {
    const bytes = data instanceof Uint8Array ? data : Buffer.from(data || [])
    if (!bytes.length) return { ok: false, error: 'Nothing to upload.' }

    const form = new FormData()
    form.append('files', new Blob([bytes]), String(name || 'upload.bin'))
    if (directory && directory !== '/') form.append('directory', String(directory))

    const res = await withTimeout(fetch(url, { method: 'POST', body: form }), 300000)
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      let detail = ''
      try {
        detail = JSON.parse(text)?.error || ''
      } catch {}
      return { ok: false, error: detail || `Upload failed (HTTP ${res.status}).` }
    }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err?.message || 'Upload failed.' }
  }
}

async function panelDownload({ url, headers = {}, auth = { mode: 'none' }, timeout = 120000 } = {}) {
  if (!url) return { ok: false, status: 0, error: 'Missing URL' }
  const finalHeaders = { ...headers }
  if (auth?.mode === 'apikey' && auth.key) finalHeaders.Authorization = `Bearer ${auth.key}`
  try {
    const res = await withTimeout(fetch(url, { headers: finalHeaders, redirect: 'follow' }), timeout)
    if (!res.ok) return { ok: false, status: res.status, error: `Download failed (HTTP ${res.status}).` }
    const buffer = Buffer.from(await res.arrayBuffer())
    return { ok: true, status: res.status, base64: buffer.toString('base64'), size: buffer.length }
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || 'Download failed.' }
  }
}

const sockets = new Map() 

function sendToRenderer(id, event, args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('copanel:ws-event', { id, event, args })
  }
}

async function wsConnect({ id, wsUrl, token, tokenUrl, auth, origin }) {
  if (!id || !wsUrl || !token) return { ok: false, error: 'Missing websocket credentials.' }

  wsDisconnect({ id })
  if (typeof WebSocket === 'undefined') return { ok: false, error: 'WebSocket unavailable in this runtime.' }

  const panelOrigin = originOf(origin) || originOf(tokenUrl)

  return new Promise((resolve) => {
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let ws
    try {
      ws = panelOrigin
        ? new WebSocket(wsUrl, { headers: { Origin: panelOrigin } })
        : new WebSocket(wsUrl)
    } catch (err) {
      try {
        ws = new WebSocket(wsUrl)
      } catch (err2) {
        return done({ ok: false, error: err2?.message || 'WebSocket construction failed.' })
      }
    }

    const entry = { ws, token, tokenUrl, auth, attempts: 0, origin: panelOrigin }
    sockets.set(id, entry)

    let opened = false
    let probing = false
    const failBeforeOpen = (event) => {
      if (probing) return
      probing = true
      const fallback = describeWsError(event, panelOrigin) || 'The socket closed before the handshake completed.'
      probeWsUpgrade(wsUrl, panelOrigin)
        .then((status) => done({ ok: false, error: wsFailureMessage(status, panelOrigin, fallback) }))
        .catch(() => done({ ok: false, error: fallback }))
    }

    ws.onopen = () => {
      opened = true
      ws.send(JSON.stringify({ event: 'auth', args: [token] }))
      setTimeout(() => done({ ok: true }), 500)
    }

    ws.onmessage = (raw) => {
      let msg
      try {
        msg = JSON.parse(typeof raw.data === 'string' ? raw.data : String(raw.data))
      } catch {
        return
      }
      if (msg.event === 'auth success') {
        entry.authenticated = true
        done({ ok: true, authenticated: true })
        sendToRenderer(id, 'auth success', [])
        return
      }
      if (msg.event === 'jwt error') {
        refreshSocketToken(id, entry)
        return
      }
      sendToRenderer(id, msg.event, Array.isArray(msg.args) ? msg.args : [msg.args])
    }

    ws.onerror = (event) => {
      if (opened) done({ ok: false, error: describeWsError(event, panelOrigin) || 'WebSocket error.' })
      else failBeforeOpen(event)
    }

    ws.onclose = () => {
      if (sockets.get(id) === entry) sockets.delete(id)
      sendToRenderer(id, 'close', [])
      if (opened) done({ ok: false, error: 'WebSocket closed.' })
      else failBeforeOpen(null)
    }
  })
}

async function refreshSocketToken(id, entry) {
  if (!entry.tokenUrl || !entry.auth) return
  try {
    const fresh = await panelRequest({ url: entry.tokenUrl, auth: entry.auth })
    const token = fresh.json?.data?.token
    const socketUrl = fresh.json?.data?.socket
    if (!token || !socketUrl) return
    const result = await wsConnect({
      id,
      wsUrl: socketUrl,
      token,
      tokenUrl: entry.tokenUrl,
      auth: entry.auth,
      origin: entry.origin,
    })
    if (result.ok) sendToRenderer(id, 'reconnected', [])
  } catch {}
}

function wsSend({ id, event, args }) {
  const entry = sockets.get(id)
  if (!entry || entry.ws.readyState !== 1) return { ok: false, error: 'Not connected.' }
  try {
    entry.ws.send(JSON.stringify({ event, args }))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Send failed.' }
  }
}

function wsDisconnect({ id }) {
  const entry = sockets.get(id)
  if (!entry) return { ok: true }
  try {
    entry.ws.onopen = entry.ws.onmessage = entry.ws.onclose = entry.ws.onerror = null
    entry.ws.close(1000, 'client disconnect')
  } catch {}
  sockets.delete(id)
  return { ok: true }
}

function wsStatus({ id }) {
  const entry = sockets.get(id)
  return { ok: !!entry, connected: !!entry && entry.ws.readyState === 1, authenticated: !!entry?.authenticated }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch || {}))

  ipcMain.handle('secret:set', (_e, { name, value }) => {
    if (!name) return { ok: false, error: 'Missing secret name.' }
    const current = readSettings()
    const secrets = { ...(current.secrets || {}) }
    if (value === '' || value === null || value === undefined) delete secrets[name]
    else secrets[name] = encrypt(value)
    writeSettings({ secrets })
    return { ok: true }
  })
  ipcMain.handle('secret:get', (_e, { name }) => {
    const current = readSettings()
    return { value: name ? decrypt(current.secrets?.[name]) : '' }
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isDev,
  }))

  ipcMain.handle('panel:http', (_e, opts) => panelRequest(opts || {}))
  ipcMain.handle('panel:upload', (_e, opts) => panelUpload(opts || {}))
  ipcMain.handle('panel:download', (_e, opts) => panelDownload(opts || {}))

  ipcMain.handle('ws:connect', (_e, opts) => wsConnect(opts || {}))
  ipcMain.handle('ws:send', (_e, opts) => wsSend(opts || {}))
  ipcMain.handle('ws:disconnect', (_e, opts) => wsDisconnect(opts || {}))
  ipcMain.handle('ws:status', (_e, opts) => wsStatus(opts || {}))

  ipcMain.handle('mc:ping', (_e, opts) => mcStatusPing(opts || {}))

  ipcMain.handle('clipboard:write', (_e, text) => {
    try {
      clipboard.writeText(String(text ?? ''))
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('shell:open', (_e, url) => {
    try {
      const parsed = new URL(String(url))
      if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: 'Only http(s) links are allowed.' }
      shell.openExternal(parsed.toString())
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || 'Invalid URL.' }
    }
  })

  ipcMain.handle('win:minimize', () => { mainWindow?.minimize(); return { ok: true } })
  ipcMain.handle('win:close', () => { mainWindow?.close(); return { ok: true } })
  ipcMain.handle('win:quit', () => { app.quit(); return { ok: true } })

  ipcMain.handle('update:get', () => updater.getState())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:download', () => updater.download())
  ipcMain.handle('update:install', () => updater.install())
  ipcMain.handle('update:set-auto', (_e, value) => updater.setAuto(value))
}

function createWindow() {
  const saved = readSettings()
  const bootTheme = saved.theme === 'light' ? 'light' : 'dark'
  const bootLang = saved.language === 'en' ? 'en' : 'vi'
  const withBootParams = (raw) => {
    const url = new URL(raw)
    url.searchParams.set('theme', bootTheme)
    url.searchParams.set('lang', bootLang)
    return url.toString()
  }

  mainWindow = new BrowserWindow({
    width: 1066,
    height: 690,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: bootTheme === 'light' ? '#f5f5f5' : '#0a0a0a',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(withBootParams(process.env.VITE_DEV_SERVER_URL))
  } else if (isDev) {
    mainWindow.loadURL(withBootParams('http://localhost:5174'))
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { theme: bootTheme, lang: bootLang },
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('copanel:update', updater.getState())
  })

  mainWindow.on('closed', () => {
    for (const id of [...sockets.keys()]) wsDisconnect({ id })
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  updater.init({
    send: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('copanel:update', state)
    },
    readSettings,
    writeSettings,
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
