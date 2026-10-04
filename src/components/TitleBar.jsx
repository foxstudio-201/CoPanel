import { useState, useEffect } from 'react'
import { Power, Globe, ShieldCheck, Pulse } from '@phosphor-icons/react'
import { useApp } from '../i18n/AppContext'
import AccountSwitcher from './AccountSwitcher'

function StatusDot({ color }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: color }} />
    </span>
  )
}

const PANEL_LABEL = { pterodactyl: 'Pterodactyl', calagopus: 'Calagopus' }


export default function TitleBar({ onCloseRequest, user, onLogout, onAddAccount, lang, theme, server, panelType, session }) {
  const isDark = theme !== 'light'
  const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const textHover = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'
  const hoverBg = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const hoverBgRed = isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'
  const closeHoverBg = 'rgba(239,68,68,0.8)'
  const statBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
  const statBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'

  const account = session?.account || user || null
  const [latency, setLatency] = useState(-1)
  const connected = session?.status === 'connected'

  useEffect(() => {
    if (!connected || !session?.url) {
      setLatency(-1)
      return
    }
    let cancelled = false
    const tick = async () => {
      const started = performance.now()
      try {
        const auth = { mode: 'apikey', key: session.apiKey }
        const res = await window.electronAPI.panelRequest({
          url: `${session.url}/api/client/account`,
          method: 'GET',
          headers: { Accept: 'application/vnd.pterodactyl.v1+json, application/json' },
          auth,
          timeout: 8000,
        })
        if (cancelled) return
        setLatency(res?.status ? Math.round(performance.now() - started) : -1)
      } catch {
        if (!cancelled) setLatency(-1)
      }
    }
    tick()
    const iv = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [connected, session?.url, session?.apiKey])

  const handleMinimize = () => window.electronAPI?.minimizeWindow?.()
  const handleClose = () => {
    if (window.electronAPI?.closeWindow) {
      if (onCloseRequest) onCloseRequest()
      else window.electronAPI.closeWindow()
    }
  }

  const panelColor = panelType === 'calagopus' ? '#22d3ee' : '#a78bfa'

  return (
    <div className="drag-region flex items-center justify-between h-11 px-4 fixed top-0 left-0 right-0" style={{ zIndex: 9999 }}>
      <div className="flex items-center gap-3 no-drag" style={{ marginLeft: '72px' }}>
        {account && (
          <AccountSwitcher
            session={session}
            lang={lang}
            theme={theme}
            onAddAccount={onAddAccount}
          />
        )}
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 no-drag flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: statBg, border: `1px solid ${statBorder}` }}>
          <StatusDot color={connected ? '#22c55e' : '#6b7280'} />
          <Globe size={12} style={{ color: connected ? '#22c55e' : '#6b7280' }} />
          <span className="text-[10px] font-medium" style={{ color: connected ? '#22c55e' : '#6b7280' }}>
            {session?.demo ? 'DEMO' : PANEL_LABEL[panelType] || 'Panel'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: statBg, border: `1px solid ${statBorder}` }}>
          <ShieldCheck size={12} style={{ color: panelColor }} />
          <span className="text-[10px] font-medium" style={{ color: panelColor }}>
            {connected ? 'API Key' : '—'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: statBg, border: `1px solid ${statBorder}` }}>
          <Pulse size={12} style={{ color: latency >= 0 && latency < 400 ? '#22c55e' : latency >= 0 ? '#eab308' : '#6b7280' }} />
          <span className="text-[10px] font-medium" style={{ color: latency >= 0 && latency < 400 ? '#22c55e' : latency >= 0 ? '#eab308' : '#6b7280' }}>
            {latency < 0 ? '---' : `${latency}ms`}
          </span>
        </div>

        {server && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: statBg, border: `1px solid ${statBorder}` }}>
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: server.status === 'running' ? '#22c55e' : server.status === 'starting' || server.status === 'stopping' ? '#eab308' : '#ef4444' }}
            />
            <span className="text-[10px] font-medium max-w-[160px] truncate" style={{ color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.7)' }}>
              {server.name}
            </span>
          </div>
        )}
      </div>

      <div className="no-drag flex items-center gap-1">
        {account && onLogout && (
          <button
            onClick={onLogout}
            data-tip={lang === 'vi' ? 'Ngắt kết nối' : 'Disconnect'}
            className="w-8 h-8 flex items-center justify-center rounded transition-colors mr-1"
            style={{ color: textColor }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = hoverBgRed }}
            onMouseLeave={(e) => { e.currentTarget.style.color = textColor; e.currentTarget.style.background = 'transparent' }}
          >
            <Power size={18} weight="duotone" />
          </button>
        )}
        <button
          onClick={handleMinimize}
          data-tip="Minimize"
          className="w-8 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: textColor }}
          onMouseEnter={(e) => { e.currentTarget.style.color = textHover; e.currentTarget.style.background = hoverBg }}
          onMouseLeave={(e) => { e.currentTarget.style.color = textColor; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
        </button>
        <button
          onClick={handleClose}
          data-tip="Close"
          className="w-8 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: textColor }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = closeHoverBg }}
          onMouseLeave={(e) => { e.currentTarget.style.color = textColor; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
