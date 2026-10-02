import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Memory, Cpu, HardDrive, Lightning, Play, Stop, ArrowsClockwise, Network, Power, PencilSimple } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import * as api from '../../api/client.js'
import { mapResources, mapState, mapActivity, cpuScale } from '../../api/driver.js'
import { getSession, subscribe } from '../../api/store.js'
import { openConsole, closeConsole, sendConsole } from '../../api/session.js'
import { pingServer, serverPingTarget, getPingOverride, setPingOverride, parsePingAddress } from '../../api/players.js'

const CHART_WINDOW = 20_000

const SERIES = {
  light: { primary: '#0891b2', secondary: '#d97706', grid: 'rgba(0,0,0,0.09)', tick: '#6b7280' },
  dark: { primary: '#22d3ee', secondary: '#facc15', grid: 'rgba(255,255,255,0.08)', tick: '#9ca3af' },
}

const STATUS_META = {
  running: { color: '#22c55e', labelEn: 'Online', labelVi: 'Trực tuyến' },
  starting: { color: '#eab308', labelEn: 'Starting', labelVi: 'Đang khởi động' },
  stopping: { color: '#eab308', labelEn: 'Stopping', labelVi: 'Đang tắt' },
  installing: { color: '#eab308', labelEn: 'Installing', labelVi: 'Đang cài' },
  stopped: { color: '#ef4444', labelEn: 'Offline', labelVi: 'Ngoại tuyến' },
  offline: { color: '#ef4444', labelEn: 'Offline', labelVi: 'Ngoại tuyến' },
  error: { color: '#ef4444', labelEn: 'Error', labelVi: 'Lỗi' },
}

const ACTION_META = {
  start: { color: '#22c55e', labelEn: 'Server marked as started', labelVi: 'Server đã khởi động', Icon: Play },
  stop: { color: '#ef4444', labelEn: 'Server marked as stopped', labelVi: 'Server đã dừng', Icon: Stop },
  kill: { color: '#dc2626', labelEn: 'Server killed', labelVi: 'Server bị tắt cứng', Icon: Stop },
  restart: { color: '#eab308', labelEn: 'Server restarted', labelVi: 'Server khởi động lại', Icon: ArrowsClockwise },
  install: { color: '#06b6d4', labelEn: 'Server installed', labelVi: 'Server đã cài đặt', Icon: Lightning },
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)))
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatMB(n) {
  if (!n || n <= 0) return '0 MB'
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} GB`
  return `${Math.round(n)} MB`
}

function formatRate(bytesPerSec) {
  const n = Number(bytesPerSec) || 0
  if (n <= 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)))
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatPercent(v) {
  const n = Number(v) || 0
  return `${Number(n.toFixed(2))}%`
}

function clampPct(n) {
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 100) return 100
  return Math.round(n * 10) / 10
}

function usageColor(pct) {
  const p = clampPct(pct)
  if (p >= 90) return '#ef4444'
  if (p >= 75) return '#f97316'
  if (p >= 50) return '#eab308'
  return '#22c55e'
}

function niceCeil(value, binary = false) {
  if (!Number.isFinite(value) || value <= 0) return binary ? 1024 : 1
  if (binary) return 2 ** Math.ceil(Math.log2(value))
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 4, 5, 10].find((step) => magnitude * step >= value) ?? 10) * magnitude
}

function ema(prev, next, alpha = 0.18) {
  if (prev == null || !Number.isFinite(prev)) return Number(next) || 0
  return prev + ((Number(next) || 0) - prev) * alpha
}

function avgRing(ring, value, max = 6) {
  ring.push(Number(value) || 0)
  if (ring.length > max) ring.shift()
  let sum = 0
  for (const n of ring) sum += n
  return sum / ring.length
}

function fmtDay(ts, lang) {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return lang === 'vi' ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`
}

function fmtTime(ts) {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function fmtClock(ts) {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function StatusDot({ color }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
    </span>
  )
}

const StreamChart = memo(function StreamChart({ samplesRef, seriesColors, seriesIndices, format, binary = false, min = 0, theme, height = 200 }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const yMaxRef = useRef(0)
  const cfgRef = useRef(null)
  const idxMap = seriesIndices || seriesColors.map((_, i) => i)
  cfgRef.current = { samplesRef, seriesColors, idxMap, format, binary, min, theme }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cfg = cfgRef.current
      if (!cfg) return
      const palette = SERIES[cfg.theme] || SERIES.dark
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w < 8 || h < 8) return
      const pw = Math.floor(w * dpr)
      const ph = Math.floor(h * dpr)
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const padLeft = 44
      const padTop = 6
      const padBottom = 6
      const padRight = 4
      const plotW = Math.max(1, w - padLeft - padRight)
      const plotH = Math.max(1, h - padTop - padBottom)
      const end = Date.now()
      const start = end - CHART_WINDOW
      const cutoff = start - 1500
      const samples = cfg.samplesRef.current || []

      let peak = cfg.min
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        if (s.t < cutoff) continue
        for (let k = 0; k < cfg.idxMap.length; k++) {
          const val = s.v[cfg.idxMap[k]]
          if (val != null && val > peak) peak = val
        }
      }
      const wanted = niceCeil(peak * 1.2, cfg.binary)
      if (yMaxRef.current === 0 || wanted > yMaxRef.current || wanted < yMaxRef.current * 0.35) {
        yMaxRef.current = wanted
      }
      const yMax = yMaxRef.current || 1

      ctx.lineWidth = 1
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < 3; i++) {
        const tickVal = (yMax * i) / 2
        const y = padTop + plotH * (1 - tickVal / yMax)
        ctx.strokeStyle = palette.grid
        ctx.beginPath()
        ctx.moveTo(padLeft, y)
        ctx.lineTo(w - padRight, y)
        ctx.stroke()
        ctx.fillStyle = palette.tick
        ctx.fillText(cfg.format(tickVal), padLeft - 6, y)
      }

      const seriesPaths = []
      for (let si = 0; si < cfg.seriesColors.length; si++) {
        const dataIdx = cfg.idxMap[si]
        const color = cfg.seriesColors[si]
        const dash = si === 1 && cfg.seriesColors.length > 1 ? [6, 4] : null
        const pts = []
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i]
          if (s.t < cutoff || s.t > end) continue
          const v = s.v[dataIdx]
          if (v == null || !Number.isFinite(v)) continue
          const x = padLeft + ((s.t - start) / CHART_WINDOW) * plotW
          if (x < padLeft - 4 || x > w - padRight + 4) continue
          const y = padTop + plotH * (1 - Math.max(0, v) / yMax)
          pts.push([x, y])
        }
        if (pts.length === 0) continue
        pts.push([padLeft + plotW, pts[pts.length - 1][1]])
        if (pts[0][0] > padLeft) pts.unshift([padLeft, pts[0][1]])
        if (pts.length < 2) continue
        seriesPaths.push({ color, dash, pts })
      }

      for (const { color, pts } of seriesPaths) {
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH)
        grad.addColorStop(0, `${color}44`)
        grad.addColorStop(1, `${color}06`)
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1]
          const curr = pts[i]
          const mx = (prev[0] + curr[0]) / 2
          const my = (prev[1] + curr[1]) / 2
          ctx.quadraticCurveTo(prev[0], prev[1], mx, my)
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
        ctx.lineTo(pts[pts.length - 1][0], padTop + plotH)
        ctx.lineTo(pts[0][0], padTop + plotH)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
      }

      for (const { color, dash, pts } of seriesPaths) {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1]
          const curr = pts[i]
          const mx = (prev[0] + curr[0]) / 2
          const my = (prev[1] + curr[1]) / 2
          ctx.quadraticCurveTo(prev[0], prev[1], mx, my)
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash(dash || [])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative w-full h-full" style={{ minHeight: height }}>
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
    </div>
  )
})

function SeriesKey({ color, dash }) {
  return (
    <svg width={14} height={2} viewBox="0 0 14 2" className="shrink-0 overflow-visible" aria-hidden>
      <line x1={1} y1={1} x2={13} y2={1} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  )
}

const ChartBlock = memo(function ChartBlock({ theme, title, value, legend, Icon, iconColor, offline, offlineLabel, children }) {
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const iconBg = theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'

  return (
    <div className="min-w-0 flex flex-col rounded-xl overflow-hidden" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
      <div className="border-b px-4 py-3" style={{ borderColor }}>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <h3 className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold" style={{ color: textColor }}>
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: iconBg }}
            >
              <Icon size={14} weight="duotone" style={{ color: iconColor }} />
            </span>
            <span className="truncate">{title}</span>
          </h3>
          {!offline && value != null && value !== undefined && (
            <span className="shrink-0 text-sm font-mono font-semibold tabular-nums" style={{ color: iconColor }}>
              {value}
            </span>
          )}
          {!offline && legend && (
            <span className="flex max-w-full flex-col items-start gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
              {legend}
            </span>
          )}
        </div>
      </div>
      <div className="relative min-h-[240px] flex-1 px-3 pt-3 pb-2">
        {offline ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2" style={{ color: labelColor, background: 'transparent' }}>
            <Power size={28} weight="duotone" />
            <span className="text-sm">{offlineLabel}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
})

function ClockCard({ theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="px-4 pt-4 pb-3 text-center" style={{ borderBottom: `1px solid ${borderColor}`, background: cardBg }}>
      <p className="text-[10px] uppercase font-bold tracking-widest" style={{ color: labelColor }}>
        {lang === 'vi' ? 'Thời gian' : 'Time'}
      </p>
      <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: textColor }}>{fmtClock(now)}</p>
      <p className="text-xs mt-0.5" style={{ color: labelColor }}>{fmtDay(now, lang)}</p>
    </div>
  )
}

function GaugeCard({ label, percent, value, detail, color, Icon, theme, hint }) {
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const track = theme === 'light' ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'

  const stroke = 11
  const margin = 12 
  const size = 152 
  const r = (size - stroke) / 2 - margin
  const cx = size / 2
  const cy = margin + stroke / 2 + r
  const svgH = cy + stroke / 2 + 2
  const arcLen = Math.PI * r
  const p = clampPct(percent) / 100
  const dash = p * arcLen
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`

  const gr = r + stroke / 2 + 5
  const gLen = Math.PI * gr
  const glowArc = `M ${cx - gr} ${cy} A ${gr} ${gr} 0 0 1 ${cx + gr} ${cy}`
  const lit = dash > 0.6

  return (
    <div className="flex-1 min-w-0 rounded-xl p-4 flex flex-col items-center gap-2" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
      <div className="flex items-center gap-1.5 self-start">
        <Icon size={14} weight="duotone" style={{ color }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor }}>{label}</span>
      </div>

      <div className="relative" style={{ width: size, height: svgH + 16 }}>
        <svg width={size} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
          {lit ? (
            <path
              d={glowArc}
              fill="none"
              stroke={color}
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={`${(p * gLen).toFixed(2)} ${gLen}`}
              opacity={0.55}
              style={{ filter: 'blur(3px)' }}
            />
          ) : null}
          <path d={arc} fill="none" stroke={track} strokeWidth={stroke} strokeLinecap="round" />
          {lit ? (
            <path
              d={arc}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash.toFixed(2)} ${arcLen}`}
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
          ) : null}
        </svg>
        {}
        <div
          className="absolute left-0 right-0 flex justify-center"
          style={{ top: svgH, transform: 'translateY(-50%)' }}
        >
          <span
            className="text-lg font-bold font-mono tabular-nums leading-none whitespace-nowrap"
            style={{ color: textColor }}
          >
            {value}
          </span>
        </div>
      </div>

      <p
        className="text-[11px] font-mono text-center"
        style={{ color: labelColor, cursor: hint ? 'help' : undefined }}
        title={hint || undefined}
      >
        {detail}
      </p>
    </div>
  )
}

function groupHistory(history, lang) {
  const groups = []
  const byDay = new Map()
  for (const item of history) {
    const key = fmtDay(item.at, lang)
    if (!byDay.has(key)) {
      const g = { day: key, items: [] }
      byDay.set(key, g)
      groups.push(g)
    }
    byDay.get(key).items.push(item)
  }
  return groups
}

export default function OverviewPage({ server, theme, lang, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const histBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'

  const [status, setStatus] = useState(server?.status || 'stopped')
  const [util, setUtil] = useState({})
  const [history, setHistory] = useState([])
  const [tps, setTps] = useState(() => getSession().tps ?? null)
  const [tpsAt, setTpsAt] = useState(() => getSession().tpsAt || 0)
  const [ping, setPing] = useState({ id: '', data: null, at: 0 })
  const pingSeqRef = useRef(0)
  const [addrDraft, setAddrDraft] = useState(null)
  const addrCancelRef = useRef(false)
  const [netSpeeds, setNetSpeeds] = useState({ rxSpeed: 0, txSpeed: 0 })
  const [smooth, setSmooth] = useState({ cpu: null, mem: null, tx: null, rx: null })
  const statusRef = useRef(status)
  statusRef.current = status
  const serverRef = useRef(server)
  serverRef.current = server
  const notifiedRef = useRef(server?.status || 'stopped')
  const netPrevRef = useRef(null)
  const wasOfflineRef = useRef(false)
  const smoothRef = useRef({ cpu: null, mem: null, tx: null, rx: null })
  const samplesRef = useRef([])
  const rateHistRef = useRef({ tx: [], rx: [] })
  const pollingRef = useRef(false)
  const pollRef = useRef(null)

  const meta = STATUS_META[status] || STATUS_META.stopped
  const statusColor = meta.color
  const statusLabel = lang === 'vi' ? meta.labelVi : meta.labelEn

  const bgImage = server?.game === 'terraria' ? './terraria_backgound.png' : './Minecraft_backgound.png'
  const gameIcon = server?.game === 'terraria' ? './terraria_slot.png' : './Minecraft_slot.png'

  const unlimited = server?.unlimited || {}
  const cpuThreads = Number(getSession().cpuThreads) || 0
  const cpuK = cpuScale(cpuThreads)
  const memLimitMb = server?.resources?.memory || 0
  const cpuLimitPct = server?.resources?.cpuPercent || 0
  const diskLimitMb = server?.resources?.disk || 0
  const memLimit = memLimitMb * 1024 * 1024
  const cpuLimit = cpuLimitPct * cpuK
  const diskLimit = diskLimitMb * 1024 * 1024

  const memUnlimited = unlimited.memory ?? memLimitMb <= 0
  const cpuUnlimited = unlimited.cpu ?? cpuLimitPct <= 0
  const diskUnlimited = unlimited.disk ?? diskLimitMb <= 0

  const memUsed = util.memory_bytes || util.memoryUsage || 0
  const cpuUsed = (util.cpu_absolute ?? util.cpuUsage ?? 0) * cpuK
  const diskUsed = util.disk_bytes || util.diskUsage || 0

  const ceilRef = useRef({ mem: 0, disk: 0 })
  const autoCeiling = (key, used) => {
    const wanted = niceCeil(Math.max(used, 1) * 1.2, true)
    const cur = ceilRef.current[key]
    if (!cur || wanted > cur || wanted < cur * 0.35) {
      ceilRef.current[key] = wanted
      return wanted
    }
    return cur
  }
  const memCeil = memUnlimited ? autoCeiling('mem', Math.max(memUsed, smooth.mem ?? 0)) : memLimit
  const diskCeil = diskUnlimited ? autoCeiling('disk', diskUsed) : diskLimit

  const memPct = memCeil > 0 ? (memUsed / memCeil) * 100 : 0
  const cpuPct = cpuUnlimited ? Math.min(100, cpuUsed) : (cpuUsed / cpuLimit) * 100
  const diskPct = diskCeil > 0 ? (diskUsed / diskCeil) * 100 : 0
  const unlimitedColor = '#a78bfa'
  const round1 = (v) => Math.round(Number(v) * 10) / 10
  const round2 = (v) => Math.round(Number(v) * 100) / 100

  const TPS_TTL = 120_000
  const tpsFresh = tpsAt > 0 && Date.now() - tpsAt < TPS_TTL
  const tpsValue = status === 'running' && tpsFresh ? tps : null
  const tpsKnown = tpsValue != null
  const tpsDisplay = tpsKnown ? tpsValue : 0
  const tpsPct = tpsKnown ? (tpsDisplay / 20) * 100 : 0
  const tpsColor = !tpsKnown
    ? (status === 'running' ? '#eab308' : '#6b7280')
    : tpsValue >= 19 ? '#22c55e' : tpsValue >= 15 ? '#eab308' : tpsValue >= 10 ? '#f97316' : '#ef4444'
  const tpsHint = tpsKnown
    ? (lang === 'vi' ? 'TPS đọc được từ console của server' : 'TPS read from the server console')
    : (lang === 'vi'
        ? 'Chưa có TPS: console phải đang mở và game phải in TPS/MSPT ra log (Paper mới không in mặc định)'
        : 'No TPS yet: the console must be connected and the game must print TPS/MSPT (modern Paper does not by default)')

  const PLAYERS_TTL = 90_000
  const knownOffline = status === 'stopped' || status === 'offline' || status === 'error'
  const pingFresh = ping.id === server?.id && ping.at > 0 && Date.now() - ping.at < PLAYERS_TTL
  const pingOk = pingFresh && ping.data?.ok
  const pingError = !knownOffline && pingFresh && ping.data && !ping.data.ok ? ping.data.error : ''
  const pingTarget = (pingOk && { host: ping.data.host, port: ping.data.port, via: ping.data.via }) || serverPingTarget(server)
  const playersOnline = pingOk ? ping.data.online : knownOffline ? 0 : null
  const playersMax = pingOk && ping.data.max > 0 ? ping.data.max : null
  const addressText = !pingTarget
    ? '—'
    : pingOk && ping.data.srv
      ? pingTarget.host
      : `${pingTarget.host}:${pingTarget.port}`
  const manualAddr = !!getPingOverride(server?.id)
  const addressHint = pingOk && ping.data.srv
    ? `SRV → ${ping.data.srv}`
    : manualAddr
      ? (lang === 'vi' ? 'Địa chỉ bạn tự nhập — bấm để sửa' : 'Manual address — click to edit')
      : (lang === 'vi' ? 'Địa chỉ lấy từ panel — bấm để sửa' : 'Address from the panel — click to edit')
  const playersHint = [
    lang === 'vi'
      ? `${playersOnline ?? '?'} người chơi online / ${playersMax ?? '?'} slot, đọc trực tiếp từ server bằng Server List Ping (TCP) - không qua panel, cập nhật mỗi 30 giây khi server chạy.`
      : `${playersOnline ?? '?'} players online / ${playersMax ?? '?'} slots, read straight from the server with a TCP Server List Ping - never through the panel, refreshed every 30s while it runs.`,
    pingError ? (lang === 'vi' ? `Không ping được server: ${pingError}.` : `Ping failed: ${pingError}.`) : '',
  ].filter(Boolean).join(' ')

  const cpuHint = cpuThreads > 0
    ? (lang === 'vi'
        ? `Thang % trên tổng ${cpuThreads} luồng của node (giống spark). Panel gốc báo theo % của 1 nhân: ${round1(cpuUsed * cpuThreads)}%`
        : `Scale: percent of all ${cpuThreads} node threads (spark's scale). The panel's native figure is ${round1(cpuUsed * cpuThreads)}% of one core`)
    : cpuUnlimited
      ? (lang === 'vi'
          ? 'Server không giới hạn CPU — đang hiển thị theo % của 1 nhân. Vào Hệ thống để nhập số luồng node và chuyển sang thang % hệ thống.'
          : 'No CPU cap — shown as percent of one core. Set the node thread count in System to switch to the system-wide scale.')
      : (lang === 'vi'
          ? 'Giới hạn CPU của Pterodactyl tính theo % của 1 nhân (100% = 1 nhân)'
          : 'Pterodactyl CPU limits are per core (100% = 1 full core)')

  const isOffline = status === 'stopped' || status === 'offline' || status === 'error'
  const killable = status === 'stopping'
  const powerBtn = 'flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 min-w-[88px]'

  useEffect(() => {
    setStatus(server?.status || 'stopped')
  }, [server?.status])

  useEffect(() => {
    if (server?.status) notifiedRef.current = server.status
  }, [server?.status])

  useEffect(() => subscribe((state) => {
    setTps(state.tps)
    setTpsAt(state.tpsAt || 0)
  }), [])

  const serverLive = status === 'running' || status === 'starting'
  useEffect(() => {
    if (!server?.id) return undefined
    let cancelled = false
    if (!serverLive) {
      pingSeqRef.current++
      setPing({ id: server.id, data: null, at: 0 })
      return undefined
    }
    const load = async () => {
      const seq = ++pingSeqRef.current
      const res = await pingServer(server).catch(() => null)
      if (!cancelled && seq === pingSeqRef.current) setPing({ id: server.id, data: res, at: Date.now() })
    }
    load()
    const iv = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [server?.id, serverLive])

  const commitAddr = useCallback((raw) => {
    const srv = serverRef.current || server
    if (!srv?.id) return
    const text = String(raw || '').trim()
    if (text && !parsePingAddress(text)) return 
    setAddrDraft(null)
    setPingOverride(srv.id, text)
    setPing({ id: srv.id, data: null, at: 0 })
    const seq = ++pingSeqRef.current
    pingServer(srv, { force: true })
      .then((res) => {
        if (seq === pingSeqRef.current) setPing({ id: srv.id, data: res, at: Date.now() })
      })
      .catch(() => {})
  }, [server])

  useEffect(() => {
    const id = server?.id
    const running = status === 'running'
    if (!id || !running) return undefined
    const onEvent = ({ event }) => {
      if (event === 'auth success') sendConsole(id, 'send logs', [null]).catch(() => {})
    }
    openConsole(id, onEvent).catch(() => {})
    return () => { closeConsole(id) }
  }, [server?.id, status === 'running'])

  const syncStatus = useCallback((next) => {
    if (!next) return
    if (statusRef.current !== next) setStatus(next)
    if (next === notifiedRef.current) return
    notifiedRef.current = next
    const srv = serverRef.current
    if (typeof onServerUpdate === 'function' && srv) {
      try {
        onServerUpdate({ ...srv, status: next })
      } catch {}
    }
  }, [onServerUpdate])
  const syncRef = useRef(syncStatus)
  syncRef.current = syncStatus

  const handlePower = useCallback(async (action) => {
    const srv = serverRef.current
    if (!srv?.id) return
    const next = action === 'stop' || action === 'kill' ? 'stopping' : 'starting'
    syncStatus(next)
    try {
      await api.power(srv.id, action)
      const msg = action === 'start' ? (lang === 'vi' ? 'Đang khởi động server…' : 'Starting server…')
        : action === 'restart' ? (lang === 'vi' ? 'Đang khởi động lại server…' : 'Restarting server…')
        : action === 'kill' ? (lang === 'vi' ? 'Đang force stop server…' : 'Force stopping server…')
        : (lang === 'vi' ? 'Đang dừng server…' : 'Stopping server…')
      showToast(msg, 'success')
      setTimeout(() => { if (pollRef.current) pollRef.current() }, 1500)
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
      if (pollRef.current) pollRef.current()
    }
  }, [lang, syncStatus])

  const pushChartSample = useCallback((cpu, mem, tx, rx) => {
    const t = Date.now()
    const next = samplesRef.current
    next.push({ t, v: [cpu, mem, tx, rx] })
    const cutoff = t - (CHART_WINDOW + 4000)
    if (next[0] && next[0].t < cutoff) {
      let i = 0
      while (i < next.length && next[i].t < cutoff) i++
      if (i > 0) next.splice(0, i)
    }
  }, [])

  useEffect(() => {
    if (!server?.id) return
    let cancelled = false
    let historyTick = 1
    samplesRef.current = []
    ceilRef.current = { mem: 0, disk: 0 }
    wasOfflineRef.current = false
    netPrevRef.current = null
    rateHistRef.current = { tx: [], rx: [] }
    smoothRef.current = { cpu: null, mem: null, tx: null, rx: null }

    const loadHistory = async () => {
      try {
        const rows = await api.getActivity(server.id, { per_page: 25 })
        if (!cancelled) setHistory(mapActivity(rows))
      } catch {
      }
    }
    const poll = async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const res = await api.getResources(server.id)
        if (cancelled) return
        const mapped = mapResources(res)
        const nextStatus = mapState(res.current_state, serverRef.current)

        const running = nextStatus === 'running' || nextStatus === 'starting' || nextStatus === 'stopping'
        const cpuRaw = mapped.cpu_absolute * cpuScale(getSession().cpuThreads)
        const memRaw = mapped.memory_bytes
        let rxSpeed = 0
        let txSpeed = 0
        if (running) {
          const rx = mapped.network_rx_bytes
          const tx = mapped.network_tx_bytes
          const nowTs = Date.now()
          const prev = netPrevRef.current
          if (prev && nowTs > prev.t) {
            const elapsed = (nowTs - prev.t) / 1000
            if (rx >= prev.rx) rxSpeed = Math.max(0, (rx - prev.rx) / elapsed)
            if (tx >= prev.tx) txSpeed = Math.max(0, (tx - prev.tx) / elapsed)
          }
          netPrevRef.current = { rx, tx, t: nowTs }
        } else {
          netPrevRef.current = null
        }

        const s = smoothRef.current
        if (running) {
          s.cpu = ema(s.cpu, cpuRaw)
          s.mem = ema(s.mem, memRaw)
          s.tx = ema(s.tx, avgRing(rateHistRef.current.tx, txSpeed))
          s.rx = ema(s.rx, avgRing(rateHistRef.current.rx, rxSpeed))
          wasOfflineRef.current = false
          pushChartSample(s.cpu, s.mem, s.tx, s.rx)
        } else if (!wasOfflineRef.current) {
          wasOfflineRef.current = true
          s.cpu = 0
          s.mem = 0
          s.tx = 0
          s.rx = 0
          rateHistRef.current = { tx: [], rx: [] }
          pushChartSample(0, 0, 0, 0)
        }

        setUtil(mapped)
        syncRef.current(nextStatus)
        setSmooth({ cpu: s.cpu, mem: s.mem, tx: s.tx, rx: s.rx })
        setNetSpeeds({ rxSpeed: s.rx || 0, txSpeed: s.tx || 0 })
      } catch {
      } finally {
        pollingRef.current = false
      }
      if (cancelled) return
      historyTick++
      if (historyTick % 3 === 1) loadHistory()
    }
    pollRef.current = poll
    loadHistory()
    poll()
    const iv = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(iv)
      pollRef.current = null
    }
  }, [server?.id]) 

  const groups = groupHistory(history, lang).slice(0, 20)
  const totalEvents = history.length
  const offlineLoad = isOffline
  const offlineLabel = lang === 'vi' ? 'Ngoại tuyến' : 'Offline'
  const palette = SERIES[theme] || SERIES.dark
  const colorsPrimary = useMemo(() => [palette.primary], [palette.primary])
  const colorsNetwork = useMemo(() => [palette.primary, palette.secondary], [palette.primary, palette.secondary])
  const formatPct = useMemo(() => (v) => `${Number(Number(v).toFixed(0))}%`, [])
  const formatMem = useMemo(() => (v) => formatBytes(v), [])
  const formatNet = useMemo(() => (v) => formatRate(v), [])
  const idxCpu = useMemo(() => [0], [])
  const idxMem = useMemo(() => [1], [])
  const idxNet = useMemo(() => [2, 3], [])
  const memLegend = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const memValue = theme === 'light' ? '#111' : '#fff'

  const cpuDisplay = offlineLoad ? offlineLabel : formatPercent(smooth.cpu ?? cpuUsed)
  const memDisplay = offlineLoad ? offlineLabel : formatBytes(smooth.mem ?? memUsed)
  const netLegend = offlineLoad ? null : (
    <>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: palette.primary }}>
        <SeriesKey color={palette.primary} />
        <span style={{ color: memLegend }}>Outbound</span>
        <span className="font-mono tabular-nums" style={{ color: memValue }}>
          {formatRate(netSpeeds.txSpeed)}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: palette.secondary }}>
        <SeriesKey color={palette.secondary} dash="6 4" />
        <span style={{ color: memLegend }}>Inbound</span>
        <span className="font-mono tabular-nums" style={{ color: memValue }}>
          {formatRate(netSpeeds.rxSpeed)}
        </span>
      </span>
    </>
  )

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      {}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        {}
        <div className="col-span-2 rounded-2xl overflow-hidden relative group transition-all hover:shadow-xl" style={{ border: `1px solid ${borderColor}`, minHeight: 280 }}>
          <img src={bgImage} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.25) 100%)' }} />
          <div className="relative z-10 h-full p-5 flex flex-col justify-between min-h-[280px]">
            <div className="flex items-start gap-3">
              <img src={gameIcon} alt="" className="w-14 h-14 rounded-2xl object-contain shadow-lg" style={{ background: 'rgba(0,0,0,0.35)' }} />
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-white truncate">{server?.name || 'Server'}</h2>
                <p className="text-xs text-white/60 truncate">{server?.egg || server?.game || ''}{server?.version ? ` · ${server.version}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.45)', border: `1px solid ${statusColor}44` }}>
                <StatusDot color={statusColor} />
                <span className="text-[11px] font-bold" style={{ color: statusColor }}>{statusLabel}</span>
              </div>
            </div>

            {}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button
                onClick={() => handlePower('start')}
                disabled={!isOffline}
                className={powerBtn}
                style={{ background: '#22c55e', color: '#fff', opacity: isOffline ? 1 : 0.4, cursor: isOffline ? 'pointer' : 'not-allowed' }}
              >
                <Play size={13} weight="fill" /> {lang === 'vi' ? 'Khởi động' : 'Start'}
              </button>
              <button
                onClick={() => handlePower('restart')}
                disabled={isOffline}
                className={powerBtn}
                style={{ background: '#374151', color: '#e5e7eb', opacity: isOffline ? 0.4 : 1, cursor: isOffline ? 'not-allowed' : 'pointer' }}
              >
                <ArrowsClockwise size={13} weight="duotone" /> {lang === 'vi' ? 'Khởi động lại' : 'Restart'}
              </button>
              <button
                onClick={() => handlePower(killable ? 'kill' : 'stop')}
                disabled={isOffline}
                className={powerBtn}
                style={{ background: killable ? '#dc2626' : '#ef4444', color: '#fff', opacity: isOffline ? 0.4 : 1, cursor: isOffline ? 'not-allowed' : 'pointer' }}
              >
                <Stop size={13} weight="fill" /> {killable ? (lang === 'vi' ? 'Tắt cứng' : 'Kill') : (lang === 'vi' ? 'Dừng' : 'Stop')}
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-6 mt-4">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-white/50">{lang === 'vi' ? 'Địa chỉ' : 'Address'}</p>
                {addrDraft == null ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setAddrDraft(manualAddr && pingTarget ? `${pingTarget.host}:${pingTarget.port}` : '')}
                      className="text-sm font-mono text-white/90 hover:text-white flex items-center gap-1"
                      title={addressHint}
                    >
                      {addressText}
                      <PencilSimple size={11} className="opacity-60" />
                    </button>
                    {manualAddr && (
                      <button
                        onClick={() => commitAddr('')}
                        className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold hover:opacity-80"
                        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.65)' }}
                        title={lang === 'vi' ? 'Bỏ địa chỉ tự nhập, quay lại dò từ panel' : 'Clear the manual address, back to panel detection'}
                      >
                        {lang === 'vi' ? 'Tự động' : 'Auto'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <input
                      autoFocus
                      value={addrDraft}
                      onChange={(e) => setAddrDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitAddr(addrDraft)
                        } else if (e.key === 'Escape') {
                          addrCancelRef.current = true
                          setAddrDraft(null)
                        }
                      }}
                      onBlur={() => {
                        if (!addrCancelRef.current) commitAddr(addrDraft)
                        addrCancelRef.current = false
                      }}
                      placeholder={pingTarget ? `${pingTarget.host}:${pingTarget.port}` : 'play.abc.vn:25565'}
                      spellCheck={false}
                      className="text-sm font-mono bg-transparent outline-none border-b w-[210px]"
                      style={{ borderColor: 'rgba(167,139,250,0.7)', color: '#fff' }}
                    />
                    {addrDraft.trim() !== '' && !parsePingAddress(addrDraft) && (
                      <span className="text-[9px]" style={{ color: '#f87171' }}>
                        {lang === 'vi' ? 'Sai định dạng — ví dụ: play.abc.vn:25565' : 'Invalid — e.g. play.abc.vn:25565'}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-white/50">{lang === 'vi' ? 'Mã' : 'UUID'}</p>
                <p className="text-[11px] font-mono text-white/70 truncate max-w-[220px]">{server?.id || ''}</p>
              </div>
              <div title={playersHint}>
                <p className="text-[10px] uppercase font-bold tracking-wider text-white/50">{lang === 'vi' ? 'Người chơi' : 'Players'}</p>
                <p className="text-sm font-mono text-white/90">
                  <span style={{ color: playersOnline != null && playersOnline > 0 ? '#4ade80' : 'rgba(255,255,255,0.5)' }}>
                    {playersOnline != null ? playersOnline : '—'}
                  </span>
                  <span className="text-white/50"> / {playersMax != null ? playersMax : '—'}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {}
        <div className="col-span-1 rounded-2xl flex flex-col overflow-hidden" style={{ border: `1px solid ${borderColor}`, background: cardBg, minHeight: 280 }}>
          <ClockCard theme={theme} lang={lang} />
          <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0" style={{ maxHeight: 200 }}>
            <p className="text-[10px] uppercase font-bold tracking-wider px-2 mb-1.5" style={{ color: labelColor }}>
              {lang === 'vi' ? `Lịch sử (${totalEvents})` : `History (${totalEvents})`}
            </p>
            {groups.length === 0 ? (
              <p className="text-[11px] px-2 py-4 text-center" style={{ color: labelColor }}>
                {lang === 'vi' ? 'Chưa có sự kiện khởi động/dừng' : 'No start/stop events yet'}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.day} className="mb-2">
                  <p className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ background: histBg, color: labelColor }}>{g.day}</p>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {g.items.map((item, i) => {
                      const am = ACTION_META[item.action] || ACTION_META.start
                      const Icon = am.Icon || Play
                      return (
                        <div key={`${item.at}-${i}`} className="flex items-start gap-2 px-2 py-1.5 rounded-lg" style={{ background: histBg }}>
                          <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${am.color}22` }}>
                            <Icon size={11} weight="fill" style={{ color: am.color }} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold leading-tight" style={{ color: textColor }}>
                              {lang === 'vi' ? am.labelVi : am.labelEn}
                            </p>
                            <p className="text-[10px] font-mono" style={{ color: labelColor }}>{fmtTime(item.at)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {}
      <div className="flex flex-row gap-3 shrink-0">
        <GaugeCard
          theme={theme}
          label="RAM"
          percent={memPct}
          value={isOffline ? '–' : `${Math.round(memPct)}%`}
          detail={`${formatBytes(memUsed)} / ${formatBytes(memCeil)}`}
          color={memUnlimited ? unlimitedColor : usageColor(memPct)}
          Icon={Memory}
          hint={memUnlimited
            ? (lang === 'vi'
                ? `Không giới hạn RAM — thang tự co theo mức đang dùng (${formatBytes(memUsed)}), nên % là so với mức tự đặt ${formatBytes(memCeil)}`
                : `No RAM cap — the scale auto-fits usage (${formatBytes(memUsed)}), so the % is against the derived ceiling ${formatBytes(memCeil)}`)
            : (lang === 'vi'
                ? `So với giới hạn ${formatBytes(memLimit)} của server`
                : `Against this server's ${formatBytes(memLimit)} limit`)}
        />
        <GaugeCard
          theme={theme}
          label="CPU"
          percent={cpuPct}
          value={isOffline ? '–' : formatPercent(smooth.cpu ?? cpuUsed)}
          detail={cpuUnlimited
            ? (lang === 'vi' ? '∞ không giới hạn' : '∞ unlimited')
            : (lang === 'vi' ? `giới hạn ${round2(cpuLimit)}%` : `limit ${round2(cpuLimit)}%`)}
          color={usageColor(cpuPct)}
          Icon={Cpu}
          hint={cpuHint}
        />
        <GaugeCard
          theme={theme}
          label="Disk"
          percent={diskPct}
          value={isOffline ? '–' : `${Math.round(diskPct)}%`}
          detail={`${formatBytes(diskUsed)} / ${formatBytes(diskCeil)}`}
          color={diskUnlimited ? unlimitedColor : usageColor(diskPct)}
          Icon={HardDrive}
          hint={diskUnlimited
            ? (lang === 'vi'
                ? `Không giới hạn đĩa — thang tự co theo mức đang dùng (${formatBytes(diskUsed)}), % so với mức tự đặt ${formatBytes(diskCeil)}`
                : `Unlimited disk — the scale auto-fits usage (${formatBytes(diskUsed)}), so the % is against the derived ceiling ${formatBytes(diskCeil)}`)
            : (lang === 'vi'
                ? `So với giới hạn ${formatBytes(diskLimit)} của server`
                : `Against this server's ${formatBytes(diskLimit)} limit`)}
        />
        <GaugeCard
          theme={theme}
          label="TPS (mean)"
          percent={tpsPct}
          value={tpsKnown ? tpsDisplay.toFixed(1) : '–'}
          detail={tpsKnown ? 'max 20.0' : '-- / 20.0'}
          color={tpsColor}
          Icon={Lightning}
          hint={tpsHint}
        />
      </div>

      {}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0 items-stretch">
        <ChartBlock
          theme={theme}
          title="CPU Load"
          value={cpuDisplay}
          Icon={Cpu}
          iconColor={palette.primary}
          offline={offlineLoad}
          offlineLabel={offlineLabel}
        >
          <StreamChart
            samplesRef={samplesRef}
            seriesColors={colorsPrimary}
            seriesIndices={idxCpu}
            format={formatPct}
            binary={false}
            min={10}
            theme={theme}
            height={220}
          />
        </ChartBlock>
        <ChartBlock
          theme={theme}
          title="Memory Load"
          value={memDisplay}
          Icon={Memory}
          iconColor={palette.primary}
          offline={offlineLoad}
          offlineLabel={offlineLabel}
        >
          <StreamChart
            samplesRef={samplesRef}
            seriesColors={colorsPrimary}
            seriesIndices={idxMem}
            format={formatMem}
            binary
            min={64 * 1024 * 1024}
            theme={theme}
            height={220}
          />
        </ChartBlock>
        <ChartBlock
          theme={theme}
          title="Network"
          legend={netLegend}
          Icon={Network}
          iconColor={palette.primary}
          offline={offlineLoad}
          offlineLabel={offlineLabel}
        >
          <StreamChart
            samplesRef={samplesRef}
            seriesColors={colorsNetwork}
            seriesIndices={idxNet}
            format={formatNet}
            binary
            min={1024}
            theme={theme}
            height={220}
          />
        </ChartBlock>
      </div>
    </div>
  )
}
