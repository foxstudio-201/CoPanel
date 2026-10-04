export const RELEASES_URL = 'https://github.com/foxstudio-201/CoPanel/releases/latest'

const listeners = new Set()

let state = {
  status: 'idle',
  currentVersion: '',
  latestVersion: '',
  notes: '',
  progress: null,
  error: '',
  canAutoInstall: false,
  portable: false,
  auto: true,
}

export function getUpdateState() {
  return state
}

export function subscribeUpdate(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function apply(next) {
  state = { ...state, ...next }
  listeners.forEach((fn) => {
    try {
      fn(state)
    } catch {}
  })
}

export async function initUpdates() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.onUpdateEvent) return () => {}
  const unsub = api.onUpdateEvent((s) => {
    if (s) apply(s)
  })
  try {
    const initial = await api.updateGet?.()
    if (initial) apply(initial)
  } catch {}
  return unsub
}

export function checkForUpdates() {
  return window.electronAPI?.updateCheck?.()
}

export function downloadUpdate() {
  return window.electronAPI?.updateDownload?.()
}

export function installUpdate() {
  return window.electronAPI?.updateInstall?.()
}

export function setAutoUpdate(value) {
  apply({ auto: !!value })
  return window.electronAPI?.updateSetAuto?.(!!value)
}

export function openReleasesPage() {
  return window.electronAPI?.openExternal?.(RELEASES_URL)
}
