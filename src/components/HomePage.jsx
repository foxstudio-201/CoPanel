import { useState, useEffect, useRef } from 'react'
import { Memory, Cpu, HardDrive, MagnifyingGlass, ArrowsClockwise, Play, Stop, ArrowsClockwise as RestartIcon, SignOut, Globe } from '@phosphor-icons/react'
import { useApp } from '../i18n/AppContext'
import { getSession } from '../api/store.js'
import { cpuScale } from '../api/driver.js'

export function statusColor(status) {
  if (status === 'running') return '#22c55e'
  if (status === 'starting' || status === 'stopping' || status === 'installing') return '#eab308'
  if (status === 'error') return '#ef4444'
  return '#6b7280'
}

export function statusLabel(status, lang) {
  switch (status) {
    case 'running': return lang === 'vi' ? 'Trực tuyến' : 'Online'
    case 'starting': return lang === 'vi' ? 'Đang khởi động' : 'Starting'
    case 'stopping': return lang === 'vi' ? 'Đang tắt' : 'Stopping'
    case 'installing': return lang === 'vi' ? 'Đang cài đặt' : 'Installing'
    case 'error': return lang === 'vi' ? 'Lỗi' : 'Error'
    default: return lang === 'vi' ? 'Ngoại tuyến' : 'Offline'
  }
}

function ServerCard({ server, theme, lang, onOpen, onPower, busy }) {
  const textColor = '#fff'
  const labelColor = 'rgba(255,255,255,0.6)'
  const dividerColor = 'rgba(255,255,255,0.12)'
  const [menuOpen, setMenuOpen] = useState(false)

  const bgImage = server.game === 'terraria' ? './terraria_backgound.png' : './Minecraft_backgound.png'
  const gameIcon = server.game === 'terraria' ? './terraria_slot.png' : './Minecraft_slot.png'
  const color = statusColor(server.status)

  const usage = server.resourcesUsage || {}
  const memLimitMb = Number(server.resources?.memory || 0)
  const cpuK = cpuScale(getSession().cpuThreads)
  const cpuLimit = Math.round(Number(server.resources?.cpuPercent || 0) * cpuK * 100) / 100
  const diskLimitMb = Number(server.resources?.disk || 0)
  const unlimited = server.unlimited || {}
  const memUnlim = unlimited.memory ?? memLimitMb <= 0
  const cpuUnlim = unlimited.cpu ?? Number(server.resources?.cpuPercent || 0) <= 0
  const diskUnlim = unlimited.disk ?? diskLimitMb <= 0
  const memUsedMb = Math.round((Number(usage.memory_bytes) || 0) / 1048576)
  const cpuUsed = Math.round((Number(usage.cpu_absolute) || 0) * cpuK * 100) / 100
  const diskUsedMb = Math.round((Number(usage.disk_bytes) || 0) / 1048576)
  const diskLimitLabel = diskLimitMb >= 1024 ? Math.round((diskLimitMb / 1024) * 10) / 10 : diskLimitMb
  const diskLimitUnit = diskLimitMb >= 1024 ? 'GB' : 'MB'
  const fmtMb = (mb) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`)
  const address = server.ip || server.sftp?.ip || '—'

  const runPower = (e, signal) => {
    e.stopPropagation()
    if (busy) return
    onPower(server, signal)
    setMenuOpen(false)
  }

  return (
    <div
      className="rounded-2xl overflow-hidden relative transition-all hover:scale-[1.01] cursor-pointer"
      style={{ border: `1px solid ${dividerColor}` }}
      onClick={() => { if (!menuOpen) onOpen(server) }}
    >
      <img src={bgImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.93) 0%, rgba(0,0,0,0.72) 40%, rgba(0,0,0,0.42) 100%)' }} />

      <div className="relative z-10 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <img src={gameIcon} alt="" className="w-10 h-10 rounded-xl object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: textColor }}>{server.name}</p>
            <p className="text-[11px] truncate" style={{ color: labelColor }}>
              {server.egg || server.image || '—'}
            </p>
          </div>
          <span
            className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold shrink-0"
            style={{ background: 'rgba(0,0,0,0.45)', border: `1px solid ${color}55`, color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            {statusLabel(server.status, lang)}
          </span>

          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: menuOpen ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)', color: textColor }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
                <div
                  className="absolute right-0 top-full z-50 w-44 rounded-xl overflow-hidden shadow-2xl mt-1"
                  style={{ background: 'rgba(20,20,20,0.98)', border: `1px solid ${dividerColor}`, backdropFilter: 'blur(20px)' }}
                >
                  {server.status !== 'running' ? (
                    <button
                      onClick={(e) => runPower(e, 'start')}
                      disabled={busy}
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-[11px] font-semibold transition-colors hover:bg-white/10 disabled:opacity-50"
                      style={{ color: '#22c55e' }}
                    >
                      <Play size={13} weight="fill" />
                      {lang === 'vi' ? 'Khởi động' : 'Start'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={(e) => runPower(e, 'stop')}
                        disabled={busy}
                        className="w-full px-3 py-2.5 flex items-center gap-2 text-[11px] font-semibold transition-colors hover:bg-white/10 disabled:opacity-50"
                        style={{ color: '#ef4444' }}
                      >
                        <Stop size={13} weight="fill" />
                        {lang === 'vi' ? 'Dừng' : 'Stop'}
                      </button>
                      <button
                        onClick={(e) => runPower(e, 'restart')}
                        disabled={busy}
                        className="w-full px-3 py-2.5 flex items-center gap-2 text-[11px] font-semibold transition-colors hover:bg-white/10 disabled:opacity-50"
                        style={{ color: '#eab308' }}
                      >
                        <RestartIcon size={13} weight="duotone" />
                        {lang === 'vi' ? 'Khởi động lại' : 'Restart'}
                      </button>
                    </>
                  )}
                  <div className="w-full h-px my-0.5" style={{ background: dividerColor }} />
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpen(server) }}
                    className="w-full px-3 py-2.5 flex items-center gap-2 text-[11px] font-semibold transition-colors hover:bg-white/10"
                    style={{ color: '#a78bfa' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {lang === 'vi' ? 'Mở bảng điều khiển' : 'Open console'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[10px] px-2 py-0.5 rounded-md font-mono inline-flex items-center gap-1"
            style={{ background: 'rgba(255,255,255,0.1)', border: `1px solid ${dividerColor}`, color: 'rgba(255,255,255,0.75)' }}
          >
            <Globe size={10} />
            {address}{server.port ? `:${server.port}` : ''}
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-md font-mono"
            style={{ background: 'rgba(255,255,255,0.1)', border: `1px solid ${dividerColor}`, color: 'rgba(255,255,255,0.6)' }}
          >
            {server.identifier}
          </span>
        </div>

        <div className="w-full h-px" style={{ background: dividerColor }} />

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Memory size={16} weight="duotone" style={{ color: '#a78bfa' }} />
            <div>
              <p className="text-[9px] uppercase font-semibold" style={{ color: labelColor }}>RAM</p>
              <p className="text-[11px] font-bold" style={{ color: textColor }}>
                {memUnlim ? `${fmtMb(memUsedMb)} / ` : `${memUsedMb}/${memLimitMb} `}
                <span className="text-[9px] font-normal ml-0.5" style={{ color: labelColor }}>{memUnlim ? '∞' : 'MB'}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Cpu size={16} weight="duotone" style={{ color: '#3b82f6' }} />
            <div>
              <p className="text-[9px] uppercase font-semibold" style={{ color: labelColor }}>CPU</p>
              <p className="text-[11px] font-bold" style={{ color: textColor }}>
                {cpuUnlim ? `${cpuUsed}% / ` : `${cpuUsed}/${cpuLimit} `}
                <span className="text-[9px] font-normal ml-0.5" style={{ color: labelColor }}>{cpuUnlim ? '∞' : '%'}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive size={16} weight="duotone" style={{ color: '#22c55e' }} />
            <div>
              <p className="text-[9px] uppercase font-semibold" style={{ color: labelColor }}>Disk</p>
              <p className="text-[11px] font-bold" style={{ color: textColor }}>
                {diskUnlim ? `${fmtMb(diskUsedMb)} / ` : `${diskUsedMb}/${diskLimitLabel} `}
                <span className="text-[9px] font-normal ml-0.5" style={{ color: labelColor }}>{diskUnlim ? '∞' : diskLimitUnit}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


export default function HomePage({ theme, lang, session, servers, loading, error, onRefresh, onSelectServer, onPower, onDisconnect, busyId }) {
  const { setTheme } = useApp()
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const cardBorder = theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'
  const bg = theme === 'light' ? '#f5f5f5' : '#0a0a0a'
  const inputBg = theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'

  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const filtered = (servers || []).filter((s) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [s.name, s.identifier, s.egg, s.description].some((v) => String(v || '').toLowerCase().includes(q))
  })

  const runningCount = (servers || []).filter((s) => s.status === 'running').length
  const total = (servers || []).length

  const refresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div data-surface className="h-full overflow-y-auto" style={{ background: bg }}>
      <div className="shrink-0 sticky top-0 z-20 backdrop-blur-md" style={{ background: `${bg}ee`, borderBottom: `1px solid ${cardBorder}` }}>
        <div className="px-6 py-3.5 flex items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate" style={{ color: textColor }}>
              {lang === 'vi' ? 'Danh sách server' : 'Your servers'}
            </h1>
            <p className="text-[11px] truncate" style={{ color: labelColor }}>
              {session?.url || '—'} · {session?.account?.username || '—'} · {runningCount}/{total}{' '}
              {lang === 'vi' ? 'đang chạy' : 'running'}
            </p>
          </div>

          <div className="flex-1" />

          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: labelColor }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lang === 'vi' ? 'Tìm server…' : 'Search servers…'}
              className="w-52 pl-9 pr-3 py-2 rounded-lg text-xs outline-none focus:border-purple-500/50 transition-colors"
              style={{ background: inputBg, border: `1px solid ${cardBorder}`, color: textColor }}
            />
          </div>

          <button
            onClick={refresh}
            title={lang === 'vi' ? 'Làm mới' : 'Refresh'}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
            style={{ background: inputBg, border: `1px solid ${cardBorder}`, color: labelColor }}
          >
            <ArrowsClockwise size={15} className={refreshing || loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={lang === 'vi' ? 'Đổi giao diện' : 'Toggle theme'}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
            style={{ background: inputBg, border: `1px solid ${cardBorder}`, color: labelColor }}
          >
            {theme === 'light' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            )}
          </button>

          <button
            onClick={onDisconnect}
            title={lang === 'vi' ? 'Ngắt kết nối' : 'Disconnect'}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
            style={{ background: inputBg, border: `1px solid ${cardBorder}`, color: labelColor }}
          >
            <SignOut size={15} />
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          {loading && total === 0 ? (
            <p className="text-xs text-center py-16" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Đang tải danh sách server…' : 'Loading servers…'}
            </p>
          ) : error && total === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm mb-4 px-6" style={{ color: '#f87171' }}>{error}</p>
              <button
                onClick={refresh}
                className="px-5 py-2 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}
              >
                {lang === 'vi' ? 'Thử lại' : 'Retry'}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm" style={{ color: labelColor }}>
                {total === 0
                  ? (lang === 'vi' ? 'Không có server nào trong tài khoản này.' : 'No servers on this account.')
                  : (lang === 'vi' ? 'Không tìm thấy server phù hợp.' : 'No servers match your search.')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {filtered.map((server) => (
                <ServerCard
                  key={server.id || server.uuid}
                  server={server}
                  theme={theme}
                  lang={lang}
                  onOpen={onSelectServer}
                  onPower={onPower}
                  busy={busyId === server.id}
                />
              ))}
            </div>
          )}

          {error && total > 0 && (
            <p className="text-[11px] text-center mt-4" style={{ color: '#f87171' }}>{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
