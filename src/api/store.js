
const initial = {
  status: 'disconnected', 
  panelType: '', 
  url: '', 
  apiKey: '',
  demo: false, 
  account: null, 
  error: '',
  tps: null,
  tpsAt: 0, 
  cpuThreads: 0,
}

let state = { ...initial }
const listeners = new Set()

export function getSession() {
  return state
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setSession(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((fn) => {
    try {
      fn(state)
    } catch (err) {
      console.error('[copanel] session listener failed', err)
    }
  })
  return state
}

export function resetSession(patch = {}) {
  return setSession({ ...initial, cpuThreads: state.cpuThreads, ...patch })
}

export function setCpuThreads(threads) {
  const n = Math.max(0, Math.floor(Number(threads) || 0))
  if (n === state.cpuThreads) return state
  return setSession({ cpuThreads: n })
}

export function emitTps(value, at = Date.now()) {
  if (value === state.tps && Math.abs((state.tpsAt || 0) - at) < 60000) return
  setSession({ tps: value ?? null, tpsAt: value == null ? 0 : at })
}
