const listeners = new Set()
let seq = 0

export function requestConfirm(options = {}) {
  return new Promise((resolve) => {
    const req = {
      id: ++seq,
      title: options.title || '',
      message: options.message || '',
      confirmLabel: options.confirmLabel || '',
      cancelLabel: options.cancelLabel || '',
      tone: options.tone || 'danger',
      resolve,
    }
    listeners.forEach((fn) => fn(req))
  })
}

export function subscribeConfirm(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
