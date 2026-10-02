import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  UsersThree, MagnifyingGlass, ArrowsClockwise, DotsThreeVertical, Check, Trash,
  Warning, UserCircle, ChartBar, Trophy, ShieldCheck, Star, Prohibit, X, SpinnerGap,
  Gear, UserMinus, Gavel, Backpack,
} from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import InventoryModal from './InventoryModal'
import * as api from '../../api/client.js'
import { openConsole, closeConsole, sendConsole } from '../../api/session.js'
import {
  loadPlayers, deletePlayer, headUrl, pingServer, invalidatePing, uuidKey,
  parseConsolePlayers, buildPlayerCommand, isBanDuration,
} from '../../api/players.js'

const PLAYERS_TTL = 90_000
const PING_MS = 15_000
const LIST_MIN_GAP = 2_000 
const FEEDBACK_MS = 8_000 

const OPTION_META = {
  data: { Icon: UserCircle, vi: 'Dữ liệu người chơi', en: 'Player data' },
  stats: { Icon: ChartBar, vi: 'Thống kê', en: 'Statistics' },
  advancements: { Icon: Trophy, vi: 'Tiến trình (advancements)', en: 'Advancements' },
  whitelist: { Icon: ShieldCheck, vi: 'Xoá khỏi whitelist', en: 'Remove from whitelist', needsRun: true },
  op: { Icon: Star, vi: 'Xoá quyền OP', en: 'Remove OP', needsRun: true },
  unban: { Icon: Prohibit, vi: 'Bỏ lệnh ban', en: 'Unban', needsRun: true },
}

function fmtDate(ts, lang) {
  try {
    const d = new Date(ts)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return lang === 'vi'
      ? `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`
      : `${mm}/${dd}/${d.getFullYear()} ${hh}:${mi}`
  } catch {
    return '—'
  }
}

function Badge({ color, children }) {
  return (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide" style={{ background: `${color}22`, color }}>
      {children}
    </span>
  )
}

function HeadAvatar({ player, size, bg, labelColor }) {
  const [broken, setBroken] = useState(false)
  const key = player.uuid || player.name
  const src = key ? headUrl(key, size * 2) : ''
  return (
    <div className="relative rounded-lg overflow-hidden shrink-0" style={{ width: size, height: size, background: bg }}>
      <span
        className="absolute inset-0 flex items-center justify-center font-bold"
        style={{ color: labelColor, fontSize: size * 0.34 }}
      >
        {(player.name || '?').slice(0, 1).toUpperCase()}
      </span>
      {src && !broken && (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="relative w-full h-full"
          style={{ imageRendering: 'pixelated' }}
          onError={() => setBroken(true)}
        />
      )}
    </div>
  )
}

export default function PlayersPage({ server, theme, lang, onServerUpdate }) {
  const vi = lang === 'vi'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const modalBg = theme === 'light' ? '#fff' : '#1a1a1a'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const inputBg = theme === 'light' ? '#fafafa' : '#0a0a0a'
  const subtleBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'

  const [data, setData] = useState(null) 
  const [invPlayer, setInvPlayer] = useState(null) 
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')
  const [state, setState] = useState(server?.status || 'stopped')
  const [ping, setPing] = useState({ id: '', data: null, at: 0 })
  const pingSeqRef = useRef(0)
  const [target, setTarget] = useState(null)
  const [modalRender, setModalRender] = useState(false)
  const [modalClosing, setModalClosing] = useState(false)
  const [opts, setOpts] = useState({})
  const [busy, setBusy] = useState(false)
  const [consoleOn, setConsoleOn] = useState(null)
  const [modalTab, setModalTab] = useState('overview')
  const [kickReason, setKickReason] = useState('')
  const [banReason, setBanReason] = useState('')
  const [banTime, setBanTime] = useState('')
  const [actionBusy, setActionBusy] = useState('')
  const [feedback, setFeedback] = useState([])
  const listSentAtRef = useRef(0)
  const driftAtRef = useRef(0)
  const feedbackUntilRef = useRef(0)
  const feedbackNameRef = useRef('')
  const needNamesRef = useRef(false)

  const serverRef = useRef(server)
  serverRef.current = server
  const reportedRef = useRef(server?.status || '')
  const lastModalRef = useRef(null)
  if (target) lastModalRef.current = target

  const running = state === 'running'

  const load = useCallback(async () => {
    if (!server?.id) return
    setLoading(true)
    setLoadError('')
    try {
      const res = await loadPlayers(server.id)
      setData(res)
    } catch (err) {
      setLoadError(err?.message || (vi ? 'Không đọc được dữ liệu người chơi.' : 'Could not read player data.'))
    } finally {
      setLoading(false)
    }
  }, [server?.id, vi])

  useEffect(() => { load() }, [load])

  const live = running || state === 'starting'
  useEffect(() => {
    if (!server?.id) return undefined
    let cancelled = false
    if (!live) {
      pingSeqRef.current++
      setPing({ id: server.id, data: null, at: 0 })
      return undefined
    }
    const tick = async () => {
      const seq = ++pingSeqRef.current
      const res = await pingServer(serverRef.current || server).catch(() => null)
      if (!cancelled && seq === pingSeqRef.current) setPing({ id: server.id, data: res, at: Date.now() })
    }
    tick()
    const iv = setInterval(tick, PING_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [server?.id, live])

  
  const refresh = useCallback(async () => {
    const srv = serverRef.current || server
    invalidatePing(srv)
    const seq = ++pingSeqRef.current
    await Promise.all([
      load(),
      pingServer(srv, { force: true })
        .then((res) => {
          if (seq === pingSeqRef.current) setPing({ id: srv?.id || '', data: res, at: Date.now() })
        })
        .catch(() => {}),
    ])
  }, [load, server])

  const requestConsoleList = useCallback(() => {
    const srv = serverRef.current || server
    if (!srv?.id) return false
    const now = Date.now()
    if (now - listSentAtRef.current < LIST_MIN_GAP) return false
    listSentAtRef.current = now
    sendConsole(srv.id, 'send command', ['list']).catch(() => {})
    return true
  }, [server])

  useEffect(() => {
    if (!server?.id || !live) {
      setConsoleOn(null)
      return undefined
    }
    let cancelled = false
    const id = server.id
    const onEvent = ({ event, args }) => {
      if (cancelled) return
      if (event === 'auth success') {
        sendConsole(id, 'send logs', [null]).catch(() => {})
        if (needNamesRef.current) requestConsoleList()
        return
      }
      if (event !== 'console output' && event !== 'install logs') return
      const text = Array.isArray(args) ? args.filter((x) => typeof x === 'string').join('\n') : String(args ?? '')
      if (!text) return

      const name = feedbackNameRef.current
      if (name && Date.now() < feedbackUntilRef.current) {
        const quoted = name.toLowerCase()
        const lines = text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((s) => s.toLowerCase().includes(quoted) || /unknown|not online|no player|does not exist|nothing changed|are not (?:an )?operator|banned|kicked|added to the whitelist|whitelist/i.test(s))
          .slice(-3)
        if (lines.length) setFeedback((f) => [...f, ...lines].slice(-4))
      }

      const parsed = parseConsolePlayers(text)
      if (parsed.list) {
        setConsoleOn(new Set(parsed.list.map((s) => s.toLowerCase())))
        return
      }
      if (parsed.joined.length || parsed.left.length) {
        setConsoleOn((prev) => {
          if (!prev) return prev
          const next = new Set(prev)
          parsed.joined.forEach((n) => next.add(n.toLowerCase()))
          parsed.left.forEach((n) => next.delete(n.toLowerCase()))
          return next
        })
      }
    }
    openConsole(id, onEvent).catch(() => {})
    return () => {
      cancelled = true
      closeConsole(id).catch(() => {})
      setConsoleOn(null)
    }
  }, [server?.id, live, requestConsoleList])

  useEffect(() => {
    if (!server?.id) return undefined
    let cancelled = false
    const fetchState = async () => {
      try {
        const res = await api.getResources(server.id)
        if (cancelled) return
        const mapped = res.current_state === 'offline' || res.current_state === 'stopped' ? 'stopped' : res.current_state
        setState(mapped)
        if (mapped !== reportedRef.current) {
          reportedRef.current = mapped
          if (typeof onServerUpdate === 'function') onServerUpdate({ ...serverRef.current, status: mapped })
        }
      } catch {
        
      }
    }
    fetchState()
    const iv = setInterval(fetchState, 8000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [server?.id, onServerUpdate])

  useEffect(() => {
    if (target) {
      setModalRender(true)
      setModalClosing(false)
      return undefined
    }
    if (!modalRender) return undefined
    setModalClosing(true)
    const t = setTimeout(() => {
      setModalRender(false)
      setModalClosing(false)
      lastModalRef.current = null
    }, 220)
    return () => clearTimeout(t)
  }, [target, modalRender])

  const pingFresh = ping.id === server?.id && ping.at > 0 && Date.now() - ping.at < PLAYERS_TTL
  const pingOk = pingFresh && ping.data?.ok
  const sample = useMemo(() => (pingOk && Array.isArray(ping.data.sample) ? ping.data.sample : []), [pingOk, ping.data])
  const knownSample = useMemo(
    () => sample.filter((s) => uuidKey(s.id) && !/^anonymous player$/i.test(String(s.name || ''))),
    [sample],
  )
  const sampleNames = useMemo(() => new Set(knownSample.map((s) => String(s.name || '').toLowerCase()).filter(Boolean)), [knownSample])
  const sampleUuids = useMemo(() => new Set(knownSample.map((s) => uuidKey(s.id)).filter(Boolean)), [knownSample])
  const usingConsole = consoleOn != null
  const onlineCount = pingOk ? ping.data.online : usingConsole ? consoleOn.size : live ? null : 0
  const pingError = live && pingFresh && ping.data && !ping.data.ok ? ping.data.error : ''
  const sampleCapped = pingOk && !usingConsole && ping.data.online > knownSample.length
  const namesHidden = !usingConsole && pingOk && ping.data.online > 0 && knownSample.length === 0
  const needNames = live && !usingConsole && pingFresh && (!pingOk || ping.data.online > knownSample.length)

  useEffect(() => {
    needNamesRef.current = needNames
    if (needNames) requestConsoleList()
  }, [needNames, requestConsoleList])

  useEffect(() => {
    if (!usingConsole || !pingOk || consoleOn.size === ping.data.online) return
    const now = Date.now()
    if (now - driftAtRef.current < 30_000) return
    if (requestConsoleList()) driftAtRef.current = now
  }, [usingConsole, pingOk, consoleOn, ping.data, requestConsoleList])

  const isOn = useCallback(
    (p) => {
      const name = String(p.name || '').toLowerCase()
      if (usingConsole) return !!name && consoleOn.has(name)
      return sampleNames.has(name) || sampleUuids.has(uuidKey(p.uuid))
    },
    [usingConsole, consoleOn, sampleNames, sampleUuids],
  )

  const counts = useMemo(() => {
    const rows = data?.players || []
    let on = 0
    let op = 0
    let banned = 0
    for (const p of rows) {
      if (isOn(p)) on += 1
      if (p.op) op += 1
      if (p.banned) banned += 1
    }
    return { all: rows.length, online: on, offline: rows.length - on, op, banned }
  }, [data, isOn])

  const TABS = [
    { key: 'all', label: vi ? 'Tổng player' : 'All players', count: counts.all },
    { key: 'online', label: vi ? 'Đang online' : 'Online', count: counts.online },
    { key: 'offline', label: vi ? 'Offline' : 'Offline', count: counts.offline },
    { key: 'op', label: vi ? 'Có quyền' : 'Operators', count: counts.op },
    { key: 'banned', label: vi ? 'Bị ban' : 'Banned', count: counts.banned },
  ]

  const list = useMemo(() => {
    const rows = data?.players || []
    const q = query.trim().toLowerCase()
    const byTab = rows.filter((p) => {
      switch (tab) {
        case 'online': return isOn(p)
        case 'offline': return !isOn(p)
        case 'op': return p.op
        case 'banned': return p.banned
        default: return true
      }
    })
    const filtered = q
      ? byTab.filter((p) => (p.name || '').toLowerCase().includes(q) || p.uuid.toLowerCase().replace(/-/g, '').includes(q.replace(/-/g, '')))
      : byTab
    return [...filtered].sort((a, b) => (isOn(b) ? 1 : 0) - (isOn(a) ? 1 : 0))
  }, [data, query, tab, isOn])

  const optionsFor = useCallback((p) => {
    const world = data?.world || 'world'
    const out = []
    if (p.dataFile || p.dataOldFile) out.push({ key: 'data', hint: `${world}/playerdata/${p.dataFile || p.dataOldFile}` })
    if (p.statsFile) out.push({ key: 'stats', hint: `${world}/stats/${p.statsFile}` })
    if (p.advFile) out.push({ key: 'advancements', hint: `${world}/advancements/${p.advFile}` })
    if (p.whitelisted && p.name) out.push({ key: 'whitelist', hint: `whitelist remove ${p.name}` })
    if (p.op && p.name) out.push({ key: 'op', hint: `deop ${p.name}` })
    if (p.banned && p.name) out.push({ key: 'unban', hint: `pardon ${p.name}` })
    return out
  }, [data?.world])

  const openModal = (p) => {
    setTarget(p)
    setModalTab('overview')
    setKickReason('')
    setBanReason('')
    setBanTime('')
    setActionBusy('')
    setFeedback([])
    setOpts(Object.fromEntries(optionsFor(p).map((o) => [o.key, true])))
  }
  const closeModal = () => setTarget(null)

  const view = target || lastModalRef.current
  const viewOptions = view ? optionsFor(view) : []
  const viewName = view?.name || ''

  
  const runAction = async (kind) => {
    const srv = serverRef.current || server
    if (!view || !srv?.id || actionBusy) return
    if (kind === 'ban' && !isBanDuration(banTime)) {
      showToast(vi ? 'Thời hạn không hợp lệ. Ví dụ: 30m, 12h, 7d, 1d12h.' : 'Invalid duration. Examples: 30m, 12h, 7d, 1d12h.', 'error')
      return
    }
    const cmd = buildPlayerCommand(kind, view, {
      reason: kind === 'kick' ? kickReason : banReason,
      duration: kind === 'ban' ? banTime : '',
    })
    if (!cmd) {
      showToast(vi ? 'Không xác định được tên người chơi để gửi lệnh.' : 'Cannot use this player name in a command.', 'error')
      return
    }
    setActionBusy(kind)
    if (kind === 'kick') setKickReason('')
    if (kind === 'ban') setBanReason('')
    feedbackNameRef.current = viewName
    feedbackUntilRef.current = Date.now() + FEEDBACK_MS
    setFeedback([`> ${cmd}`])
    try {
      const sent = await sendConsole(srv.id, 'send command', [cmd]).catch(() => null)
      if (!sent?.ok) await api.sendCommand(srv.id, cmd)
      showToast(vi ? `Đã gửi lệnh: ${cmd}` : `Command sent: ${cmd}`, 'success')
      if (kind !== 'kick') setTimeout(() => { load().catch(() => {}) }, 1500)
    } catch (err) {
      setFeedback((f) => [...f, err?.message || (vi ? 'Gửi lệnh thất bại.' : 'Command failed.')])
      showToast(err?.message || (vi ? 'Gửi lệnh thất bại.' : 'Command failed.'), 'error')
    } finally {
      setActionBusy('')
    }
  }
  const selectedCount = viewOptions.filter((o) => {
    const meta = OPTION_META[o.key]
    return (opts[o.key] ?? true) && (!meta?.needsRun || running)
  }).length

  const labelOf = (key) => {
    const k = key === 'playerdata' ? 'data' : key
    const meta = OPTION_META[k]
    return meta ? (vi ? meta.vi : meta.en) : key
  }

  const handleDelete = async () => {
    if (!view || busy) return
    const payload = {}
    let count = 0
    for (const o of viewOptions) {
      const meta = OPTION_META[o.key]
      const on = (opts[o.key] ?? true) && (!meta?.needsRun || running)
      payload[o.key] = on
      if (on) count += 1
    }
    if (!count) {
      showToast(vi ? 'Chọn ít nhất một mục để xoá.' : 'Select at least one item to delete.', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await deletePlayer(server.id, data?.world || 'world', view, payload)
      if (res.failed.length) {
        showToast(
          vi
            ? `Xoá xong một phần. Lỗi: ${res.failed.map(labelOf).join(', ')}`
            : `Partially deleted. Failed: ${res.failed.map(labelOf).join(', ')}`,
          'error',
        )
      } else {
        showToast(
          vi
            ? `Đã xoá dữ liệu của ${view.name || view.uuid}`
            : `Deleted data for ${view.name || view.uuid}`,
          'success',
        )
      }
      closeModal()
      await load()
    } catch (err) {
      showToast(err?.message || (vi ? 'Xoá thất bại.' : 'Delete failed.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const maxShown = (pingOk && ping.data.max > 0 ? ping.data.max : null) || data?.maxPlayers || null
  const totalShown = data ? data.players.length : null
  const pingVia = pingOk
    ? `${ping.data.host}:${ping.data.port}${ping.data.srv ? ` (SRV → ${ping.data.srv})` : ''}`
    : ''
  const chipHint = [
    vi
      ? 'Server List Ping qua TCP, làm mới mỗi 15 giây khi server chạy.'
      : 'TCP Server List Ping, refreshed every 15s while the server runs.',
    usingConsole
      ? (vi
          ? 'Tên người chơi đang online lấy từ console (phản hồi của lệnh list và các dòng join/leave) vì ping không trả về tên; lệnh list chỉ được gửi khi thật cần.'
          : 'Online names come from the console (the `list` reply and join/leave lines) because the ping does not return them; `list` is only sent when needed.')
      : '',
    needNames
      ? (vi ? 'Đang chờ console trả về danh sách tên…' : 'Waiting for the console to report the names…')
      : sampleCapped
        ? (vi
            ? `Danh sách tên tối đa ~12 nên chỉ ${knownSample.length} người chơi được đánh dấu Online.`
            : `The name sample is capped at ~12, so only ${knownSample.length} players are marked online.`)
        : '',
    pingVia ? (vi ? `Đang ping: ${pingVia}.` : `Pinging ${pingVia}.`) : '',
    pingError ? (vi ? `Lỗi: ${pingError}.` : `Error: ${pingError}.`) : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {}
      <div className="shrink-0 flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${borderColor}`, background: cardBg }}>
        <div className="flex items-center gap-2 min-w-0">
          <UsersThree size={18} weight="duotone" style={{ color: '#a78bfa' }} />
          <span className="text-[13px] font-semibold" style={{ color: textColor }}>{vi ? 'Người chơi' : 'Players'}</span>
          {data?.world && (
            <span className="text-[10px] font-mono truncate" style={{ color: labelColor }}>{data.world}</span>
          )}
        </div>

        <div className="flex-1" />

        {pingError && (
          <span
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg whitespace-nowrap"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
            title={vi
              ? `Không ping được server: ${pingError}. Kiểm tra enable-status trong server.properties, tường lửa của node, hoặc địa chỉ trong mục Network.`
              : `Ping failed: ${pingError}. Check enable-status in server.properties, the node firewall, or the address on the Network page.`}
          >
            <Warning size={11} weight="duotone" />
            {vi ? 'Không ping được server' : 'Ping failed'}
          </span>
        )}
        <span
          className="text-[11px] font-mono px-2 py-1 rounded-lg whitespace-nowrap"
          style={{ background: subtleBg, color: labelColor }}
          title={chipHint}
        >
          {vi ? 'Online' : 'Online'}:{' '}
          <b style={{ color: onlineCount != null && onlineCount > 0 ? '#22c55e' : textColor }}>
            {onlineCount != null ? onlineCount : '—'}
          </b>
          {maxShown ? ` / ${maxShown}` : ''}
          {sampleCapped ? <span style={{ color: '#eab308' }}> *</span> : ''}
        </span>
        <span className="text-[11px] font-mono px-2 py-1 rounded-lg whitespace-nowrap" style={{ background: subtleBg, color: labelColor }}>
          {vi ? 'Tổng' : 'Total'}: <b style={{ color: textColor }}>{totalShown ?? '—'}</b>
        </span>

        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: labelColor }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={vi ? 'Tìm tên hoặc UUID…' : 'Search name or UUID…'}
            className="pl-7 pr-3 py-1.5 rounded-lg text-[11px] outline-none w-[190px]"
            style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
          style={{ background: subtleBg, color: labelColor }}
          title={vi ? 'Tải lại' : 'Reload'}
        >
          <ArrowsClockwise size={14} weight="duotone" className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2" style={{ borderBottom: `1px solid ${borderColor}`, background: cardBg }}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:opacity-90"
              style={active
                ? { background: 'rgba(167,139,250,0.18)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.4)' }
                : { background: subtleBg, color: labelColor, border: '1px solid transparent' }}
            >
              {t.label} <span style={{ opacity: 0.65 }}>({t.count})</span>
            </button>
          )
        })}
      </div>

      {}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading && !data ? (
          <div className="h-full flex flex-col items-center justify-center gap-3" style={{ color: labelColor }}>
            <SpinnerGap size={26} className="animate-spin" />
            <span className="text-[12px]">{vi ? 'Đang đọc dữ liệu người chơi…' : 'Reading player data…'}</span>
          </div>
        ) : loadError ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <Warning size={26} weight="duotone" style={{ color: '#f59e0b' }} />
            <p className="text-[12px] max-w-md" style={{ color: textColor }}>{loadError}</p>
            <button
              onClick={load}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ background: '#a78bfa', color: '#fff' }}
            >
              {vi ? 'Thử lại' : 'Retry'}
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
            <UsersThree size={30} weight="duotone" style={{ color: labelColor }} />
            <p className="text-[12px] font-semibold" style={{ color: textColor }}>
              {query
                ? (vi ? 'Không có người chơi nào khớp tìm kiếm.' : 'No player matches the search.')
                : tab === 'online' && namesHidden
                  ? (vi ? 'Đang chờ console cho biết ai đang online…' : 'Waiting for the console to list who is online…')
                  : tab !== 'all'
                    ? (vi ? 'Không có người chơi trong mục này.' : 'Nobody in this tab.')
                    : (vi ? 'Chưa tìm thấy dữ liệu người chơi.' : 'No player data found.')}
            </p>
            {!query && namesHidden && (tab === 'online' || tab === 'offline') && (
              <p className="text-[11px] max-w-md leading-relaxed" style={{ color: labelColor }}>
                {vi
                  ? `Server có ${ping.data.online} người chơi online nhưng ping không công khai tên (chỉ trả về "Anonymous Player"), nên trang này hỏi console bằng lệnh list để biết ai đang online.`
                  : `The server has ${ping.data.online} players online but hides their names (the ping only returns "Anonymous Player"), so this page asks the console with the \`list\` command to find out who is online.`}
              </p>
            )}
            {!query && tab === 'all' && (
              <p className="text-[11px] max-w-md leading-relaxed" style={{ color: labelColor }}>
                {vi
                  ? 'Trang này đọc dữ liệu Minecraft trong thư mục thế giới (playerdata, usercache.json, whitelist…). Nếu server chưa từng chạy hoặc dùng game khác (ví dụ Terraria), sẽ không có gì để hiển thị.'
                  : 'This page reads Minecraft world data (playerdata, usercache.json, whitelist…). If the server has never run, or runs another game (e.g. Terraria), there is nothing to show.'}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
            {list.map((p) => {
              const isOnline = isOn(p)
              const actions = optionsFor(p)
              return (
                <div
                  key={p.uuid || p.name}
                  className="relative rounded-xl p-3 flex gap-3 transition-colors"
                  style={{ background: cardBg, border: `1px solid ${isOnline ? 'rgba(34,197,94,0.35)' : borderColor}` }}
                >
                  <HeadAvatar player={p} size={48} bg={subtleBg} labelColor={labelColor} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0 pr-6">
                      <span className="text-[13px] font-semibold truncate" style={{ color: textColor }}>
                        {p.name || (vi ? 'Không rõ tên' : 'Unknown')}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {isOnline && <Badge color="#22c55e">Online</Badge>}
                      {p.op && <Badge color="#a78bfa">OP{p.opLevel > 1 ? ` ${p.opLevel}` : ''}</Badge>}
                      {p.whitelisted && <Badge color="#38bdf8">Whitelist</Badge>}
                      {p.banned && <Badge color="#ef4444">{vi ? 'Bị ban' : 'Banned'}</Badge>}
                      {!p.hasData && !p.banned && <Badge color="#6b7280">{vi ? 'Không có dữ liệu' : 'No data'}</Badge>}
                    </div>
                    <p className="text-[10px] font-mono truncate mt-1.5" style={{ color: labelColor }} title={p.uuid || ''}>
                      {p.uuid || '—'}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: labelColor }}>
                      {vi ? 'Lần cuối' : 'Last seen'}: {p.lastSeen > 0 ? fmtDate(p.lastSeen, lang) : '—'}
                    </p>
                  </div>
                  {p.hasData && (
                    <button
                      onClick={() => setInvPlayer(p)}
                      className="absolute top-2 right-11 w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:opacity-80 cursor-pointer"
                      style={{ color: '#a78bfa', background: '#a78bfa1a' }}
                      title={vi ? 'Xem / sửa kho đồ…' : 'View and edit inventory…'}
                    >
                      <Backpack size={15} weight="duotone" />
                    </button>
                  )}
                  {(p.name || actions.length > 0) && (
                    <button
                      onClick={() => openModal(p)}
                      className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ color: labelColor, background: subtleBg }}
                      title={vi ? 'Quản lý người chơi…' : 'Manage player…'}
                    >
                      <DotsThreeVertical size={16} weight="bold" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {invPlayer && (
        <InventoryModal
          serverId={server.id}
          world={data?.world || 'world'}
          player={invPlayer}
          online={isOn(invPlayer)}
          theme={theme}
          lang={lang}
          onClose={() => setInvPlayer(null)}
        />
      )}

      {}
      {modalRender && view && (
        <div
          className={`modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4${modalClosing ? ' closing' : ''}`}
          style={{
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            pointerEvents: modalClosing ? 'none' : 'auto',
          }}
          onClick={() => { if (!modalClosing && !busy && !actionBusy) closeModal() }}
        >
          <div
            className={`modal-content w-full max-w-[480px] max-h-[85vh] rounded-2xl overflow-hidden flex flex-col${modalClosing ? ' closing' : ''}`}
            style={{ background: modalBg, border: `1px solid ${borderColor}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${borderColor}` }}>
              <Gear size={15} weight="duotone" style={{ color: '#a78bfa' }} />
              <h3 className="text-xs font-bold flex-1" style={{ color: textColor }}>
                {vi ? 'Quản lý người chơi' : 'Manage player'}
              </h3>
              <button
                onClick={() => { if (!busy && !actionBusy) closeModal() }}
                className="p-1 rounded-lg hover:opacity-70"
                style={{ color: labelColor }}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-4 pt-3 shrink-0">
              <div className="flex items-center gap-3">
                <HeadAvatar player={view} size={40} bg={subtleBg} labelColor={labelColor} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold truncate" style={{ color: textColor }}>
                    {view.name || (vi ? 'Không rõ tên' : 'Unknown')}
                  </p>
                  <p className="text-[10px] font-mono truncate" style={{ color: labelColor }}>{view.uuid || '—'}</p>
                </div>
                <div className="flex flex-wrap gap-1 justify-end shrink-0">
                  {isOn(view) && <Badge color="#22c55e">Online</Badge>}
                  {view.op && <Badge color="#a78bfa">OP{view.opLevel > 1 ? ` ${view.opLevel}` : ''}</Badge>}
                  {view.banned && <Badge color="#ef4444">{vi ? 'Bị ban' : 'Banned'}</Badge>}
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-3">
                {[
                  { key: 'overview', label: vi ? 'Tổng quan' : 'Overview', Icon: Gear },
                  { key: 'features', label: vi ? 'Chức năng' : 'Features', Icon: Trash },
                ].map((t) => {
                  const active = modalTab === t.key
                  const Icon = t.Icon
                  return (
                    <button
                      key={t.key}
                      onClick={() => setModalTab(t.key)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:opacity-90"
                      style={active
                        ? { background: 'rgba(167,139,250,0.18)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.4)' }
                        : { background: subtleBg, color: labelColor, border: '1px solid transparent' }}
                    >
                      <Icon size={12} weight="duotone" />
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="px-4 py-3 overflow-y-auto flex-1" style={{ borderTop: `1px solid ${borderColor}` }}>
              {modalTab === 'overview' ? (
                <>
                  {!running && (
                    <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <Warning size={14} weight="duotone" style={{ color: '#f59e0b' }} className="mt-0.5 shrink-0" />
                      <p className="text-[10px] leading-relaxed" style={{ color: vi ? '#b45309' : '#fbbf24' }}>
                        {vi
                          ? 'Server phải đang chạy mới gửi được lệnh lên console.'
                          : 'The server must be running to send commands through the console.'}
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: labelColor }}>
                    {vi ? 'Quyền hạn (OP)' : 'Permissions (OP)'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => runAction('op')}
                      disabled={!running || !!actionBusy || view.op}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: 'rgba(167,139,250,0.14)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.35)' }}
                    >
                      {actionBusy === 'op' ? <SpinnerGap size={12} className="animate-spin" /> : <Star size={12} weight="duotone" />}
                      {vi ? 'Cấp OP' : 'Grant OP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction('deop')}
                      disabled={!running || !!actionBusy || !view.op}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: subtleBg, color: textColor, border: `1px solid ${borderColor}` }}
                    >
                      {actionBusy === 'deop' ? <SpinnerGap size={12} className="animate-spin" /> : <Prohibit size={12} weight="duotone" />}
                      {vi ? 'Xoá OP' : 'Remove OP'}
                    </button>
                  </div>

                  <p className="text-[10px] uppercase font-bold tracking-wider mt-4 mb-2" style={{ color: labelColor }}>
                    Kick
                  </p>
                  <input
                    value={kickReason}
                    onChange={(e) => setKickReason(e.target.value)}
                    placeholder={vi ? 'Nội dung (lý do) — không bắt buộc' : 'Reason — optional'}
                    className="w-full px-3 py-2 rounded-xl text-[11px] outline-none"
                    style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                  />
                  <button
                    type="button"
                    onClick={() => runAction('kick')}
                    disabled={!running || !!actionBusy}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(245,158,11,0.14)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.35)' }}
                  >
                    {actionBusy === 'kick' ? <SpinnerGap size={12} className="animate-spin" /> : <UserMinus size={12} weight="duotone" />}
                    {vi ? 'Kick người chơi' : 'Kick player'}
                  </button>

                  <p className="text-[10px] uppercase font-bold tracking-wider mt-4 mb-2" style={{ color: labelColor }}>
                    Ban
                  </p>
                  <div className="flex flex-col gap-2">
                    <input
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      placeholder={vi ? 'Nội dung (lý do) — không bắt buộc' : 'Reason — optional'}
                      className="w-full px-3 py-2 rounded-xl text-[11px] outline-none"
                      style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                    />
                    <input
                      value={banTime}
                      onChange={(e) => setBanTime(e.target.value)}
                      placeholder={vi ? 'Thời hạn: 30m, 12h, 7d, 1d12h… (trống = vĩnh viễn)' : 'Duration: 30m, 12h, 7d, 1d12h… (empty = permanent)'}
                      className="w-full px-3 py-2 rounded-xl text-[11px] outline-none"
                      style={{ background: inputBg, border: `1px solid ${banTime && !isBanDuration(banTime) ? '#ef4444' : borderColor}`, color: textColor }}
                    />
                  </div>
                  {banTime && !isBanDuration(banTime) ? (
                    <p className="text-[10px] mt-1" style={{ color: '#ef4444' }}>
                      {vi
                        ? 'Thời hạn không hợp lệ. Ví dụ: 30m, 12h, 7d, 1d12h.'
                        : 'Invalid duration. Examples: 30m, 12h, 7d, 1d12h.'}
                    </p>
                  ) : banTime ? (
                    <p className="text-[10px] mt-1" style={{ color: labelColor }}>
                      {vi
                        ? `Sẽ gửi: tempban ${view.name || '<tên>'} ${banTime} … — cần plugin kiểu Essentials/LiteBans; server vanilla không có tempban.`
                        : `Will send: tempban ${view.name || '<name>'} ${banTime} … — needs an Essentials/LiteBans-style plugin; vanilla servers have no tempban.`}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => runAction('ban')}
                    disabled={!running || !!actionBusy || (!!banTime && !isBanDuration(banTime))}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}
                  >
                    {actionBusy === 'ban' ? <SpinnerGap size={12} className="animate-spin" /> : <Gavel size={12} weight="duotone" />}
                    {banTime ? 'Tempban' : (vi ? 'Ban người chơi' : 'Ban player')}
                  </button>

                  {feedback.length > 0 && (
                    <div
                      className="mt-3 px-3 py-2 rounded-xl font-mono text-[10px] leading-relaxed"
                      style={{ background: inputBg, border: `1px solid ${borderColor}`, color: labelColor }}
                    >
                      {feedback.map((line, i) => (
                        <div key={i} className="truncate" title={line}>{line}</div>
                      ))}
                    </div>
                  )}

                </>
              ) : (
                <>
                  <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: labelColor }}>
                    {vi ? 'Chọn những gì cần xoá' : 'Choose what to delete'}
                  </p>

                  <div className="flex flex-col gap-2">
                    {viewOptions.map((o) => {
                      const meta = OPTION_META[o.key]
                      const Icon = meta?.Icon || Trash
                      const disabled = !!meta?.needsRun && !running
                      const on = (opts[o.key] ?? true) && !disabled
                      return (
                        <button
                          key={o.key}
                          type="button"
                          disabled={disabled || busy}
                          onClick={() => setOpts((s) => ({ ...s, [o.key]: !s[o.key] }))}
                          className="flex items-start gap-2.5 w-full text-left px-3 py-2.5 rounded-xl transition-colors"
                          style={{
                            background: on ? 'rgba(167,139,250,0.10)' : subtleBg,
                            border: `1px solid ${on ? 'rgba(167,139,250,0.4)' : borderColor}`,
                            opacity: disabled ? 0.45 : 1,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <span
                            className="mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0"
                            style={{
                              background: on ? '#a78bfa' : 'transparent',
                              border: `1px solid ${on ? '#a78bfa' : 'rgba(148,163,184,0.5)'}`,
                            }}
                          >
                            {on && <Check size={11} weight="bold" color="#fff" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
                              <Icon size={12} weight="duotone" style={{ color: on ? '#a78bfa' : labelColor }} />
                              {vi ? meta?.vi : meta?.en}
                            </span>
                            <span className="block text-[10px] font-mono truncate mt-0.5" style={{ color: labelColor }}>{o.hint}</span>
                          </span>
                          {disabled && (
                            <span className="text-[9px] shrink-0 mt-0.5 text-right" style={{ color: '#f59e0b' }}>
                              {vi ? 'server phải đang chạy' : 'server must be running'}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  <div className="flex items-start gap-2 mt-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    <Warning size={14} weight="duotone" style={{ color: '#f59e0b' }} className="mt-0.5 shrink-0" />
                    <p className="text-[10px] leading-relaxed" style={{ color: vi ? '#b45309' : '#fbbf24' }}>
                      {vi
                        ? 'Nếu người chơi đang online, dữ liệu có thể bị máy chủ ghi lại khi họ thoát — nên kick người chơi trước khi xoá. Thao tác này không thể hoàn tác.'
                        : 'If the player is online, the server may write the data back when they leave — kick them first. This cannot be undone.'}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 shrink-0" style={{ borderTop: `1px solid ${borderColor}` }}>
              {modalTab === 'features' ? (
                <>
                  <button
                    onClick={() => { if (!busy) closeModal() }}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40"
                    style={{ background: subtleBg, color: textColor }}
                  >
                    {vi ? 'Huỷ' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={busy || selectedCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {busy ? <SpinnerGap size={12} className="animate-spin" /> : <Trash size={12} weight="duotone" />}
                    {vi ? 'Xoá' : 'Delete'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { if (!actionBusy) closeModal() }}
                  disabled={!!actionBusy}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40"
                  style={{ background: subtleBg, color: textColor }}
                >
                  {vi ? 'Đóng' : 'Close'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
