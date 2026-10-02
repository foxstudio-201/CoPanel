import { useState } from 'react'
import { useApp } from '../i18n/AppContext'
import { t } from '../i18n/translations'

const isElectron = typeof window !== 'undefined' && window.electronAPI

export default function CloseModal({ onClose }) {
  const { lang, theme } = useApp()
  const [remember, setRemember] = useState(false)

  const bg = theme === 'light' ? '#f5f5f5' : '#0a0a0a'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.5)'

  function handleQuit() {
    if (remember && isElectron) {
      window.electronAPI.saveSettings({ closeBehavior: 'quit' })
    }
    if (isElectron) window.electronAPI.quitApp()
  }

  function handleTray() {
    if (remember && isElectron) {
      window.electronAPI.saveSettings({ closeBehavior: 'tray' })
    }
    if (isElectron) window.electronAPI.closeWindow()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border overflow-hidden"
        style={{ background: theme === 'light' ? '#fff' : 'rgba(14,14,14,0.98)', borderColor: theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)' }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)' }}>
          <h3 className="text-sm font-bold" style={{ color: textColor }}>{t(lang, 'close.title')}</h3>
          <p className="text-xs mt-1" style={{ color: labelColor }}>{t(lang, 'close.ask')}</p>
        </div>

        <div className="px-5 py-3 flex flex-col gap-2">
          <button
            onClick={handleQuit}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 bg-red-500/80 hover:bg-red-500 text-white"
          >
            {t(lang, 'close.quit')}
          </button>
          <button
            onClick={handleTray}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white"
          >
            {t(lang, 'close.tray')}
          </button>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                remember ? 'bg-violet-500 border-violet-500' : ''
              }`}
              style={{ borderColor: remember ? undefined : (theme === 'light' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)') }}
              onClick={() => setRemember(!remember)}
            >
              {remember && (
                <svg viewBox="0 0 24 24" fill="white" className="w-3 h-3">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              )}
            </div>
            <span className="text-xs" style={{ color: labelColor }}>{t(lang, 'close.remember')}</span>
          </label>
        </div>
      </div>
    </div>
  )
}
