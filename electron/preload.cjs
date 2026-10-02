const { contextBridge, ipcRenderer, shell } = require('electron')

const on = (channel) => (callback) => {
  if (typeof callback !== 'function') return () => {}
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', { name, value }),
  getSecret: (name) => ipcRenderer.invoke('secret:get', { name }).then((r) => r?.value || ''),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getVersion: async () => (await ipcRenderer.invoke('app:info'))?.version || '',
  getPlatform: async () => (await ipcRenderer.invoke('app:info'))?.platform || '',

  panelRequest: (opts) => ipcRenderer.invoke('panel:http', opts),
  panelUpload: (opts) => ipcRenderer.invoke('panel:upload', opts),
  panelDownload: (opts) => ipcRenderer.invoke('panel:download', opts),

  wsConnect: (opts) => ipcRenderer.invoke('ws:connect', opts),
  wsSend: (opts) => ipcRenderer.invoke('ws:send', opts),
  wsDisconnect: (opts) => ipcRenderer.invoke('ws:disconnect', opts),
  wsStatus: (opts) => ipcRenderer.invoke('ws:status', opts),
  onWsEvent: on('copanel:ws-event'),

  mcPing: (opts) => ipcRenderer.invoke('mc:ping', opts),

  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),

  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  quitApp: () => ipcRenderer.invoke('win:quit'),
  handleCloseRequest: async () => ({ action: 'quit' }),
})
