const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')

const REPO = 'foxstudio-201/CoPanel'
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const HEADERS = { 'User-Agent': 'CoPanel', Accept: 'application/vnd.github+json' }

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR
const isDev = () => !app.isPackaged

let state = {
  status: 'idle',
  currentVersion: '',
  latestVersion: '',
  notes: '',
  releasedAt: '',
  releaseUrl: RELEASES_PAGE,
  progress: null,
  error: '',
  canAutoInstall: false,
  portable: false,
  auto: true,
  dev: false,
  platform: process.platform,
  assetName: '',
  assetSize: 0,
}

let send = () => {}
let listenersReady = false
let setupPath = ''
let latestRelease = null

function patch(next) {
  state = { ...state, ...next }
  send(state)
  return state
}

function readSettingsFn() {
  return {}
}
function writeSettingsFn() {}

function parseVersion(raw) {
  return String(raw || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
}

function compareVersions(a, b) {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] || 0) - (vb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

function pickAsset(assets, platform = process.platform) {
  const list = (assets || []).filter((a) => a && a.name)
  if (platform === 'win32') {
    const exe = list.filter((a) => /\.exe$/i.test(a.name))
    return exe.find((a) => /setup/i.test(a.name)) || exe.find((a) => !/portable/i.test(a.name)) || null
  }
  if (platform === 'darwin') {
    return list.find((a) => /\.dmg$/i.test(a.name)) || list.find((a) => /\.zip$/i.test(a.name)) || null
  }
  return list.find((a) => /\.AppImage$/i.test(a.name)) || list.find((a) => /\.deb$/i.test(a.name)) || null
}

function canSilentInstall(asset) {
  return process.platform === 'win32' && !isPortable() && !!asset
}

async function fetchLatestRelease() {
  const res = await fetch(RELEASES_API, { headers: HEADERS })
  if (!res.ok) throw new Error(`GitHub trả về HTTP ${res.status}`)
  const json = await res.json()
  const asset = pickAsset(json.assets)
  return {
    tag: json.tag_name || json.name || '',
    version: String(json.tag_name || json.name || '').replace(/^v/i, ''),
    notes: json.body || '',
    releasedAt: json.published_at || '',
    url: json.html_url || RELEASES_PAGE,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
  }
}

async function check({ quiet = false } = {}) {
  if (state.status === 'downloading' || state.status === 'installing') return state
  if (!quiet) patch({ status: 'checking', error: '' })
  else patch({ error: '' })

  const current = app.getVersion()
  try {
    const release = await fetchLatestRelease()
    latestRelease = release
    const newer = compareVersions(release.version, current) > 0
    const canInstall = canSilentInstall(release.asset)

    if (!newer) {
      return patch({
        status: 'up-to-date',
        currentVersion: current,
        latestVersion: release.version,
        releaseUrl: release.url,
        portable: isPortable(),
        canAutoInstall: false,
        progress: null,
      })
    }

    return patch({
      status: 'available',
      currentVersion: current,
      latestVersion: release.version,
      notes: release.notes,
      releasedAt: release.releasedAt,
      releaseUrl: release.url,
      assetName: release.asset?.name || '',
      assetSize: release.asset?.size || 0,
      canAutoInstall: canInstall,
      portable: isPortable(),
      progress: null,
    })
  } catch (err) {
    return patch({ status: 'error', currentVersion: current, error: err?.message || 'Kiểm tra cập nhật thất bại' })
  }
}

async function download() {
  if (state.status === 'downloading' || state.status === 'installing') return state
  if (isDev()) return patch({ status: 'error', error: 'Bản dev không hỗ trợ tự cập nhật.' })
  if (!state.latestVersion || !state.canAutoInstall) return state

  if (!latestRelease || compareVersions(latestRelease.version, state.latestVersion) !== 0) {
    latestRelease = await fetchLatestRelease().catch(() => null)
  }
  if (!latestRelease?.asset) {
    return patch({ status: 'error', error: 'Không tìm thấy file cài đặt trong bản phát hành.' })
  }
  const release = latestRelease

  const dir = path.join(os.tmpdir(), 'copanel-update')
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, release.asset.name)

  patch({ status: 'downloading', progress: { percent: 0, transferred: 0, total: release.asset.size || 0 }, error: '' })

  try {
    const res = await fetch(release.asset.url, { headers: { 'User-Agent': 'CoPanel' }, redirect: 'follow' })
    if (!res.ok) throw new Error(`Tải thất bại (HTTP ${res.status})`)

    const total = Number(res.headers.get('content-length')) || release.asset.size || 0
    const stream = fs.createWriteStream(target)
    let transferred = 0
    let lastEmit = 0

    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      transferred += value.length
      await new Promise((resolve, reject) => {
        stream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()))
      })
      const now = Date.now()
      if (now - lastEmit > 250) {
        lastEmit = now
        patch({
          progress: {
            percent: total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : null,
            transferred,
            total,
          },
        })
      }
    }
    await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())))

    setupPath = target
    return patch({
      status: 'ready',
      progress: { percent: 100, transferred, total: total || transferred },
    })
  } catch (err) {
    return patch({ status: 'error', error: err?.message || 'Tải bản cập nhật thất bại', progress: null })
  }
}

function launchInstaller(relaunchTarget) {
  const script = [
    'param([int]$appPid, [string]$setup, [string]$exe)',
    'while (Get-Process -Id $appPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
    "Start-Process -FilePath $setup -ArgumentList '/S','--updated' -Wait",
    'Start-Sleep -Milliseconds 600',
    'Start-Process -FilePath $exe',
  ].join('\r\n')

  const scriptPath = path.join(os.tmpdir(), `copanel-update-${Date.now()}.ps1`)
  fs.writeFileSync(scriptPath, script, 'utf8')

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, String(process.pid), setupPath, relaunchTarget],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.unref()
}

function install() {
  if (state.status === 'installing') return state
  if (isDev()) return patch({ status: 'error', error: 'Bản dev không hỗ trợ tự cập nhật.' })
  if (process.platform !== 'win32') {
    return patch({ status: 'error', error: 'Nền tảng này chưa hỗ trợ tự cài đặt.' })
  }
  const relaunchTarget = process.execPath
  if (!/^copanel(\.exe)?$/i.test(path.basename(relaunchTarget))) {
    return patch({ status: 'error', error: 'Không xác định được ứng dụng CoPanel đang chạy.' })
  }
  if (!setupPath || !fs.existsSync(setupPath)) {
    return patch({ status: 'error', error: 'Chưa có bản cập nhật nào được tải.' })
  }
  patch({ status: 'installing', error: '' })
  try {
    launchInstaller(relaunchTarget)
  } catch (err) {
    return patch({ status: 'error', error: err?.message || 'Không chạy được bộ cài.' })
  }
  setTimeout(() => app.quit(), 400)
  return state
}

async function runAutoUpdate() {
  if (isDev()) return
  const result = await check({ quiet: true })
  if (result.status !== 'available' || !state.canAutoInstall) return
  const downloaded = await download()
  if (downloaded.status === 'ready') install()
}

function setAuto(value) {
  const auto = !!value
  writeSettingsFn({ autoUpdate: auto })
  patch({ auto })
  if (auto) runAutoUpdate().catch(() => {})
  return state
}

function init({ send: sendFn, readSettings, writeSettings }) {
  send = typeof sendFn === 'function' ? sendFn : () => {}
  readSettingsFn = readSettings || (() => ({}))
  writeSettingsFn = writeSettings || (() => {})
  if (listenersReady) return
  listenersReady = true
  const settings = readSettingsFn() || {}
  state.auto = settings.autoUpdate !== false
  state.currentVersion = app.getVersion()
  state.portable = isPortable()
  state.dev = isDev()
  state.releaseUrl = RELEASES_PAGE
  setTimeout(() => {
    if (isDev()) return
    if (state.auto) runAutoUpdate().catch(() => {})
    else check().catch(() => {})
  }, 4000)
}

module.exports = {
  init,
  getState: () => state,
  check,
  download,
  install,
  setAuto,
  openReleases: () => RELEASES_PAGE,
  compareVersions,
}
