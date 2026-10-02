import { useState, useEffect, useCallback, useRef } from 'react'
import { AppProvider, useApp } from './i18n/AppContext'
import TitleBar from './components/TitleBar'
import Sidebar, { RAIL_W, RAIL_W_COLLAPSED } from './components/Sidebar'
import SplashScreen from './components/SplashScreen'
import ConnectPage from './components/ConnectPage'
import TooltipProvider from './components/ui/TooltipProvider'
import ToastHost from './components/ui/ToastHost'
import HomePage from './components/HomePage'
import SettingsPage from './components/SettingsPage'
import ServerPanel from './components/server/ServerPanel'
import { getSession, subscribe } from './api/store.js'
import { restoreConnection, disconnect } from './api/session.js'
import * as api from './api/client.js'
import { normalizeServer, mapState } from './api/driver.js'
import { showToast } from './lib/toast'

const POLL_MS = 8000
const SPLASH_MIN_MS = 1400
const SPLASH_FADE_MS = 380

function Spinner({ theme, text }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4" style={{ background: theme === 'light' ? '#f5f5f5' : '#0a0a0a' }}>
      <svg className="w-10 h-10 animate-spin" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" fill="none" stroke={theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'} strokeWidth="4" />
        <path d="M25 5 A20 20 0 0 1 45 25" fill="none" stroke={textColor} strokeWidth="4" strokeLinecap="round" />
      </svg>
      <p className="text-sm" style={{ color: textColor }}>{text}</p>
    </div>
  )
}

function AppContent() {
  const { lang, theme } = useApp()

  const [session, setSessionState] = useState(getSession())
  const panelType = session.panelType || ''

  const [phase, setPhase] = useState('idle')
  const [displayPage, setDisplayPage] = useState('servers')
  const [activePage, setActivePage] = useState('servers')
  const [selectedServer, setSelectedServer] = useState(null)

  const [servers, setServers] = useState([])
  const [serversLoading, setServersLoading] = useState(false)
  const [serversError, setServersError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const [showServerDropdown, setShowServerDropdown] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [version, setVersion] = useState('')

  const [boot, setBoot] = useState('splash')
  const [bootStatus, setBootStatus] = useState('boot')

  const serversRef = useRef([])
  const overridesRef = useRef(new Map()) 
  const pollTimer = useRef(null)

  useEffect(() => subscribe(setSessionState), [])

  useEffect(() => {
    if (window.electronAPI?.getVersion) window.electronAPI.getVersion().then(setVersion).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    let fadeTimer = null
    const run = async () => {
      const startedAt = Date.now()
      let saved = ''
      try {
        const s = await window.electronAPI?.getSettings?.()
        saved = s?.panel?.panelType || ''
      } catch {
      }
      if (!alive) return
      if (saved) {
        setBootStatus('connect')
        restoreConnection(saved).catch(() => {})
      }
      const hold = Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt))
      fadeTimer = setTimeout(() => {
        if (!alive) return
        setBoot('leaving')
        fadeTimer = setTimeout(() => {
          if (alive) setBoot('done')
        }, SPLASH_FADE_MS)
      }, hold)
    }
    run()
    return () => {
      alive = false
      clearTimeout(fadeTimer)
    }
  }, [])

  useEffect(() => { serversRef.current = servers }, [servers])

  const navigateTo = useCallback((page) => {
    setPhase('fading-out')
    setTimeout(() => {
      setDisplayPage(page)
      setActivePage(page)
      setPhase('fading-in')
      setTimeout(() => setPhase('idle'), 200)
    }, 200)
  }, [])

  const isFadingOut = phase === 'fading-out'
  const isFadingIn = phase === 'fading-in'
  const opacityClass = isFadingOut ? 'opacity-0' : isFadingIn ? 'opacity-100' : 'opacity-100'
  const transitionClass = `transition-opacity duration-200 ${opacityClass}`

  const pollUsage = useCallback(async (list) => {
    const target = Array.isArray(list) ? list : serversRef.current
    if (!target.length) return
    const results = await Promise.all(
      target.map(async (srv) => {
        try {
          return { id: srv.id, res: await api.getResources(srv.id) }
        } catch {
          return { id: srv.id, res: null }
        }
      }),
    )
    setServers((prev) => prev.map((srv) => {
      const hit = results.find((r) => r.id === srv.id)
      if (!hit?.res) return srv
      const status = mapState(hit.res.current_state, srv)
      overridesRef.current.set(srv.id, status)
      return { ...srv, status, resourcesUsage: hit.res.resources, powerState: hit.res.current_state }
    }))
  }, [])

  const loadServers = useCallback(async () => {
    setServersLoading(true)
    try {
      const rows = await api.listServers()
      const normalized = rows.map((r) => {
        const base = normalizeServer(r)
        const override = overridesRef.current.get(base.id)
        return { ...base, status: override || (base.isInstalling ? 'installing' : 'stopped') }
      })
      serversRef.current = normalized
      setServers(normalized)
      setServersError('')
      await pollUsage(normalized)
    } catch (err) {
      setServersError(err?.message || 'Could not load servers.')
    } finally {
      setServersLoading(false)
    }
  }, [pollUsage])

  useEffect(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    if (session.status !== 'connected') {
      setServers([])
      setSelectedServer(null)
      return
    }
    loadServers()
    pollTimer.current = setInterval(() => pollUsage(), POLL_MS)
    return () => clearInterval(pollTimer.current)
  }, [session.status, loadServers, pollUsage])

  const handlePower = async (server, signal) => {
    setBusyId(server.id)
    try {
      await api.power(server.id, signal)
      const next = signal === 'start' || signal === 'restart' ? 'starting' : 'stopping'
      overridesRef.current.set(server.id, next)
      setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, status: next } : s)))
      if (selectedServer?.id === server.id) setSelectedServer((s) => (s ? { ...s, status: next } : s))
      showToast(
        signal === 'start'
          ? (lang === 'vi' ? 'Đang khởi động server…' : 'Starting server…')
          : signal === 'restart'
            ? (lang === 'vi' ? 'Đang khởi động lại server…' : 'Restarting server…')
            : (lang === 'vi' ? 'Đang dừng server…' : 'Stopping server…'),
        'success',
        2500,
      )
      setTimeout(() => pollUsage(), 1500)
      return true
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
      return false
    } finally {
      setBusyId(null)
    }
  }

  const handleConnected = useCallback(() => {
    setPhase('fading-out')
    setTimeout(() => {
      setDisplayPage('servers')
      setActivePage('servers')
      setPhase('fading-in')
      setTimeout(() => setPhase('idle'), 200)
    }, 200)
  }, [])

  const handleDisconnect = useCallback(async () => {
    setPhase('logout-spinner')
    await disconnect({ forget: true })
    setSelectedServer(null)
    setServers([])
    setDisplayPage('servers')
    setActivePage('servers')
    setPhase('idle')
  }, [])

  const handleSelectServer = useCallback((srv) => {
    setSelectedServer(srv)
    setShowServerDropdown(false)
    navigateTo('server-overview')
  }, [navigateTo])

  const handleBackFromServer = useCallback(() => {
    setSelectedServer(null)
    navigateTo('servers')
  }, [navigateTo])

  const handleServerUpdate = useCallback((srv) => {
    setSelectedServer(srv)
    setServers((prev) => prev.map((s) => (s.id === srv.id ? { ...s, ...srv } : s)))
  }, [])

  const isConnected = session.status === 'connected'
  const isInServerPanel = displayPage.startsWith('server-') && !!selectedServer
  const railW = railCollapsed ? RAIL_W_COLLAPSED : RAIL_W

  const renderContent = () => {
    if (phase === 'startup-spinner') {
      return <Spinner theme={theme} text={lang === 'vi' ? 'Đang kiểm tra kết nối…' : 'Checking connection…'} />
    }
    if (phase === 'logout-spinner') {
      return <Spinner theme={theme} text={lang === 'vi' ? 'Đang ngắt kết nối…' : 'Disconnecting…'} />
    }
    if (session.status === 'connecting') {
      return <Spinner theme={theme} text={lang === 'vi' ? 'Đang kết nối tới panel…' : 'Connecting to panel…'} />
    }
    if (!isConnected) {
      return (
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div className={transitionClass}>
            <ConnectPage onConnected={handleConnected} />
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-1 overflow-hidden relative pt-11">
        <Sidebar
          theme={theme}
          lang={lang}
          version={version}
          servers={servers}
          selectedServer={selectedServer}
          dropdownOpen={showServerDropdown}
          onToggleDropdown={() => setShowServerDropdown((v) => !v)}
          onSelectServer={handleSelectServer}
          isInServerPanel={isInServerPanel}
          displayPage={displayPage}
          activePage={activePage}
          onNavigate={navigateTo}
          onBack={handleBackFromServer}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        />

        <div
          className="flex-1 overflow-hidden"
          style={{ marginLeft: railW, transition: 'margin-left 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        >
          <div className={`h-full ${transitionClass}`}>
            {displayPage === 'servers' && (
              <HomePage
                theme={theme}
                lang={lang}
                session={session}
                servers={servers}
                loading={serversLoading}
                error={serversError}
                onRefresh={loadServers}
                onSelectServer={handleSelectServer}
                onPower={handlePower}
                onDisconnect={handleDisconnect}
                busyId={busyId}
              />
            )}
            {displayPage === 'settings' && (
              <SettingsPage
                theme={theme}
                lang={lang}
                session={session}
                panelType={panelType}
                servers={servers}
                version={version}
                onDisconnect={handleDisconnect}
                onChangePanelType={handleDisconnect}
                onReconnect={loadServers}
              />
            )}
            {isInServerPanel && (
              <ServerPanel
                key={selectedServer.id}
                server={selectedServer}
                theme={theme}
                lang={lang}
                displayPage={displayPage}
                onBack={handleBackFromServer}
                onServerDeleted={handleBackFromServer}
                onServerUpdate={handleServerUpdate}
                onPower={handlePower}
              />
            )}
          </div>
        </div>

        <ToastHost theme={theme} />
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden relative z-10" style={{ background: 'transparent' }}>
      <TitleBar
        theme={theme}
        lang={lang}
        session={session}
        panelType={panelType}
        server={isInServerPanel ? selectedServer : null}
        onLogout={isConnected ? handleDisconnect : null}
      />
      {renderContent()}

      {boot !== 'done' && (
        <SplashScreen
          lang={lang}
          leaving={boot === 'leaving'}
          status={bootStatus}
          version={version}
        />
      )}

      <TooltipProvider />
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}

export default App
