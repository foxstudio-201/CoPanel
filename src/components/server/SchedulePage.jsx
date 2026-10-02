import { useState, useEffect, useRef } from 'react'
import {
  Plus, Trash, Play, Pause, PencilSimple, DotsThreeVertical,
  Clock, Terminal, Power, Archive, CaretRight, CaretLeft, X, Warning,
} from '@phosphor-icons/react'
import * as api from '../../api/client.js'
import { showToast } from '../../lib/toast'

const PRESETS = [
  { label: '*/5 * * * *', vi: 'Mỗi 5 phút', en: 'Every 5 minutes' },
  { label: '0 * * * *', vi: 'Mỗi giờ', en: 'Every hour' },
  { label: '0 0 * * *', vi: 'Hàng ngày 00:00', en: 'Daily 00:00' },
  { label: '0 0 * * 0', vi: 'Hàng tuần CN 00:00', en: 'Weekly Sun 00:00' },
  { label: '0 0 1 * *', vi: 'Hàng tháng ngày 1', en: 'Monthly day 1' },
  { label: '30 3 * * *', vi: 'Hàng ngày 03:30', en: 'Daily 03:30' },
]

const ACTION_OPTIONS = [
  { value: 'command', label: 'Command', vi: 'Lệnh' },
  { value: 'power', label: 'Power', vi: 'Nguồn' },
  { value: 'backup', label: 'Backup', vi: 'Sao lưu' },
]

const POWER_OPTIONS = [
  { value: 'start', vi: 'Khởi động', en: 'Start' },
  { value: 'stop', vi: 'Dừng', en: 'Stop' },
  { value: 'restart', vi: 'Khởi động lại', en: 'Restart' },
  { value: 'kill', vi: 'Tắt cưỡng bức', en: 'Kill' },
]

const MAX_TASKS = 10

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function cronValue(token, names) {
  const t = String(token).trim().toLowerCase()
  if (!t) return null
  if (names && Object.prototype.hasOwnProperty.call(names, t)) return names[t]
  if (!/^-?\d+$/.test(t)) return null
  return Number(t)
}

function parseCronField(str, min, max, names) {
  const out = new Set()
  for (const part of String(str).split(',')) {
    const p = part.trim()
    if (!p) return null
    let range = p
    let step = 1
    const slash = p.indexOf('/')
    if (slash >= 0) {
      range = p.slice(0, slash)
      step = cronValue(p.slice(slash + 1))
      if (step == null || step < 1) return null
    }
    let lo, hi
    if (range === '*' || range === '?') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      lo = cronValue(a, names)
      hi = cronValue(b, names)
    } else {
      lo = cronValue(range, names)
      hi = lo
    }
    if (lo == null || hi == null || lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size ? out : null
}

function parseCron(expr) {
  const raw = String(expr || '').trim().split(/\s+/)
  if (raw.length !== 5 || raw.some(f => !f)) return null
  const [mi, ho, dm, mo, dw] = raw
  const minute = parseCronField(mi, 0, 59)
  const hour = parseCronField(ho, 0, 23)
  const dayOfMonth = parseCronField(dm, 1, 31)
  const month = parseCronField(mo, 1, 12, MONTH_NAMES)
  const dayOfWeek = parseCronField(dw, 0, 7, DOW_NAMES)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null
  if (dayOfWeek.has(7)) { dayOfWeek.delete(7); dayOfWeek.add(0) }
  return {
    expr: raw.join(' '),
    minute, hour, dayOfMonth, month, dayOfWeek,
    raw: { minute: mi, hour: ho, day_of_month: dm, month: mo, day_of_week: dw },
    domRestricted: dm !== '*' && dm !== '?',
    dowRestricted: dw !== '*' && dw !== '?',
  }
}

function nextRunAt(parsed, from) {
  if (!parsed) return null
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = from + 366 * 24 * 60 * 60 * 1000
  let guard = 0
  while (d.getTime() <= limit && guard++ < 600000) {
    if (!parsed.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    const domOk = parsed.dayOfMonth.has(d.getDate())
    const dowOk = parsed.dayOfWeek.has(d.getDay())
    const dayOk = parsed.domRestricted && parsed.dowRestricted ? (domOk || dowOk) : (domOk && dowOk)
    if (!dayOk) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!parsed.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!parsed.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d.getTime()
  }
  return null
}

function describeCron(parsed, lang) {
  if (!parsed) return ''
  const vi = lang === 'vi'
  const { raw, minute, hour, dayOfWeek, domRestricted, dowRestricted } = parsed
  const hh = [...hour].sort((a, b) => a - b)
  const mm = [...minute].sort((a, b) => a - b)
  const step = raw.minute.match(/^\*\/(\d+)$/)
  const simple = !domRestricted && !dowRestricted && raw.month === '*'
  const clock = `${String(hh[0]).padStart(2, '0')}:${String(mm[0]).padStart(2, '0')}`

  if (simple && step && raw.hour === '*') return vi ? `Mỗi ${step[1]} phút` : `Every ${step[1]} minutes`
  if (simple && raw.minute === '*') return vi ? 'Mỗi phút' : 'Every minute'
  if (simple && raw.minute === '0' && raw.hour === '*') return vi ? 'Mỗi giờ' : 'Every hour'
  if (hh.length === 1 && mm.length === 1) {
    if (simple) return vi ? `Hàng ngày ${clock}` : `Daily ${clock}`
    if (domRestricted && !dowRestricted && raw.month === '*') {
      return vi ? `Hàng tháng ngày ${raw.day_of_month} ${clock}` : `Monthly on day ${raw.day_of_month} at ${clock}`
    }
    if (!domRestricted && dowRestricted && raw.month === '*') {
      const d = [...dayOfWeek].sort((a, b) => a - b)[0]
      const day = vi ? (d === 0 ? 'Chủ nhật' : `Thứ ${d + 1}`) : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]
      return vi ? `Hàng tuần ${day} ${clock}` : `Weekly ${day} at ${clock}`
    }
    if (raw.month !== '*') return vi ? `Hàng tháng (tháng ${raw.month}) ${clock}` : `Monthly (month ${raw.month}) at ${clock}`
  }
  return ''
}

const cronToString = (c) =>
  `${c?.minute ?? '*'} ${c?.hour ?? '*'} ${c?.day_of_month ?? '*'} ${c?.month ?? '*'} ${c?.day_of_week ?? '*'}`

function toUiSchedule(row, lang) {
  if (row.trigger_text !== undefined || Array.isArray(row.triggers)) {
    return {
      ...row,
      cronFields: {},
      cron: row.trigger_text || '',
      cronParsed: null,
      humanCron: row.trigger_text || '',
      isActive: row.is_active !== false,
      isProcessing: false,
      nextRunAt: null,
      lastRunAt: row.last_run_at || null,
      steps: [],
    }
  }
  const cronFields = row.cron || {}
  const cron = cronToString(cronFields)
  const parsed = parseCron(cron)
  return {
    ...row,
    cronFields,
    cron,
    cronParsed: parsed,
    humanCron: describeCron(parsed, lang),
    isActive: row.is_active !== false,
    isProcessing: !!row.is_processing,
    nextRunAt: row.next_run_at || (parsed ? nextRunAt(parsed, Date.now()) : null),
    lastRunAt: row.last_run_at || null,
    steps: [...(Array.isArray(row.tasks) ? row.tasks : [])]
      .sort((a, b) => (a.sequence_id || 0) - (b.sequence_id || 0))
      .map((t) => ({
        id: t.id,
        action: t.action || 'command',
        command: t.action === 'command' ? (t.payload || '') : '',
        power: t.action === 'power' ? (t.payload || 'start') : 'start',
        delay: Number(t.time_offset) || 0,
        continueOnFailure: !!t.continue_on_failure,
      })),
  }
}

function cronPayload(fields, name, isActive, onlyWhenOnline) {
  return {
    name: String(name || ''),
    minute: String(fields?.minute ?? '*'),
    hour: String(fields?.hour ?? '*'),
    day_of_month: String(fields?.day_of_month ?? '*'),
    month: String(fields?.month || '*') || '*',
    day_of_week: String(fields?.day_of_week ?? '*'),
    is_active: !!isActive,
    only_when_online: !!onlyWhenOnline,
  }
}

function stepToTask(st, idx) {
  const action = st.action || 'command'
  const body = {
    action,
    time_offset: Math.max(0, Math.min(900, Math.round(Number(st.delay) || 0))),
    sequence_id: idx + 1,
    continue_on_failure: !!st.continueOnFailure,
  }
  if (action === 'command') body.payload = String(st.command || '')
  else if (action === 'power') body.payload = String(st.power || 'start')
  return body
}

function emptyStep() {
  return { id: crypto.randomUUID?.() || String(Date.now() + Math.random()), action: 'command', command: '', power: 'start', delay: 0, continueOnFailure: false }
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}

function stepSummary(step, lang) {
  if (step.action === 'command') return `> ${step.command || '…'}`
  if (step.action === 'power') {
    const p = POWER_OPTIONS.find(x => x.value === (step.power || 'start'))
    return `⚡ ${lang === 'vi' ? (p?.vi || 'start') : (p?.en || 'start')}`
  }
  if (step.action === 'backup') return '🗄 archive'
  return step.action
}

export default function SchedulePage({ server, theme, lang, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const cardBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'
  const inputBg = theme === 'light' ? '#fff' : '#1a1a1a'
  const modalBg = theme === 'light' ? '#fff' : '#141414'

  const [schedules, setSchedules] = useState([])
  const [modal, setModal] = useState(null)
  const [preview, setPreview] = useState({ valid: false, human: '', nextRunAt: null })
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [openMenu, setOpenMenu] = useState(null)
  const [menuPos, setMenuPos] = useState(null)
  const [modalRender, setModalRender] = useState(false)
  const [modalClosing, setModalClosing] = useState(false)
  const lastModalRef = useRef(null)

  if (modal) lastModalRef.current = modal

  useEffect(() => {
    if (modal) {
      setModalRender(true)
      setModalClosing(false)
      return
    }
    if (!modalRender) return
    setModalClosing(true)
    const t = setTimeout(() => {
      setModalRender(false)
      setModalClosing(false)
      lastModalRef.current = null
    }, 220)
    return () => clearTimeout(t)
  }, [modal, modalRender])

  const viewModal = modal || lastModalRef.current
  const closeModal = () => setModal(null)

  const closeMenu = () => {
    setOpenMenu(null)
    setMenuPos(null)
  }

  const toggleMenu = (e, id) => {
    e.stopPropagation()
    if (openMenu === id) {
      closeMenu()
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const menuH = 140
    const openUp = window.innerHeight - r.bottom < menuH + 12 && r.top > menuH + 12
    setMenuPos({
      top: openUp ? r.top - menuH - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    })
    setOpenMenu(id)
  }

  const serverId = server?.id || server?.uuid

  const load = async () => {
    if (!serverId) return
    try {
      const rows = await api.listSchedules(serverId)
      setSchedules((Array.isArray(rows) ? rows : []).map(r => toUiSchedule(r, lang)))
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Không tải được lịch trình' : 'Failed to load schedules'), 'error')
    }
  }

  useEffect(() => { load() }, [serverId])

  useEffect(() => {
    setSchedules(prev => (prev.length
      ? prev.map(s => ({ ...s, humanCron: describeCron(s.cronParsed, lang) }))
      : prev))
  }, [lang])

  useEffect(() => {
    const expr = modal?.data?.cron?.trim()
    if (!expr) { setPreview({ valid: false, human: '', nextRunAt: null }); return }
    const timer = setTimeout(() => {
      const parsed = parseCron(expr)
      if (!parsed) { setPreview({ valid: false, human: '', nextRunAt: null }); return }
      const fromPanel = modal?.mode === 'edit' && expr === modal?.data?.origCron ? modal?.data?.panelNextRunAt : null
      setPreview({
        valid: true,
        human: describeCron(parsed, lang) || parsed.expr,
        nextRunAt: fromPanel || nextRunAt(parsed, Date.now()),
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [modal?.data?.cron, lang])

  const panelOnlyEditor = () => {
    if (!api.isCalagopus()) return false
    showToast(
      lang === 'vi'
        ? 'Calagopus: tạo và sửa lịch trình trên panel (app chỉ chạy/bật-tắt/xoá).'
        : 'Calagopus: create and edit schedules on the panel (the app can run/toggle/delete).',
      'error',
      5000,
    )
    return true
  }

  const openCreate = () => {
    if (panelOnlyEditor()) return
    setError('')
    setModal({ mode: 'create', data: { name: '', cron: '*/5 * * * *', isActive: true, steps: [emptyStep()] } })
  }

  const openEdit = (s) => {
    if (panelOnlyEditor()) return
    setError('')
    setModal({
      mode: 'edit',
      data: {
        id: s.id,
        name: s.name,
        cron: s.cron,
        origCron: s.cron,
        panelNextRunAt: s.nextRunAt || null,
        isActive: s.isActive !== false,
        onlyWhenOnline: s.only_when_online === true,
        steps: (s.steps || []).map(st => ({ ...st, delay: st.delay || 0 })),
      },
    })
  }

  const updateData = (patch) => setModal(m => ({ ...m, data: { ...m.data, ...patch } }))

  const updateStep = (idx, patch) => {
    setModal(m => {
      const steps = m.data.steps.map((s, i) => i === idx ? { ...s, ...patch } : s)
      return { ...m, data: { ...m.data, steps } }
    })
  }

  const addStep = () => setModal(m => (
    m.data.steps.length >= MAX_TASKS
      ? m
      : { ...m, data: { ...m.data, steps: [...m.data.steps, emptyStep()] } }
  ))
  const removeStep = (idx) => setModal(m => ({ ...m, data: { ...m.data, steps: m.data.steps.filter((_, i) => i !== idx) } }))
  const moveStep = (idx, dir) => setModal(m => {
    const steps = [...m.data.steps]
    const j = idx + dir
    if (j < 0 || j >= steps.length) return m
    ;[steps[idx], steps[j]] = [steps[j], steps[idx]]
    return { ...m, data: { ...m.data, steps } }
  })

  const validate = (data) => {
    if (!data.name?.trim()) return lang === 'vi' ? 'Nhập tên lịch trình' : 'Enter schedule name'
    if (!data.cron?.trim()) return lang === 'vi' ? 'Nhập cron' : 'Enter cron expression'
    if (!data.steps?.length) return lang === 'vi' ? 'Thêm ít nhất 1 bước' : 'Add at least one step'
    for (const st of data.steps) {
      if (st.action === 'command' && !st.command?.trim()) return lang === 'vi' ? 'Bước lệnh: nhập command' : 'Command step: enter command'
      if (st.action === 'power' && !st.power) return lang === 'vi' ? 'Bước power: chọn hành động' : 'Power step: choose action'
    }
    return ''
  }

  const syncTasks = async (scheduleId, steps, existingIds) => {
    const idSet = new Set(existingIds)
    const keep = new Set(steps.map(st => st.id).filter(id => idSet.has(id)))
    for (const id of existingIds) {
      if (!keep.has(id)) await api.deleteScheduleTask(serverId, scheduleId, id)
    }
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i]
      const body = stepToTask(st, i)
      if (idSet.has(st.id)) await api.updateScheduleTask(serverId, scheduleId, st.id, body)
      else await api.createScheduleTask(serverId, scheduleId, body)
    }
  }

  const handleSave = async () => {
    if (!modal) return
    const data = modal.data
    const err = validate(data)
    if (err) { setError(err); return }
    setError('')
    try {
      const parsed = parseCron(data.cron.trim())
      if (!parsed) {
        setError(lang === 'vi' ? 'Cron không hợp lệ' : 'Invalid cron')
        return
      }
      const payload = cronPayload(parsed.raw, data.name.trim(), data.isActive !== false, data.onlyWhenOnline === true)
      if (modal.mode === 'create') {
        const created = await api.createSchedule(serverId, payload)
        if (created?.id == null) throw new Error(lang === 'vi' ? 'Không nhận được ID lịch trình' : 'No schedule ID returned')
        await syncTasks(created.id, data.steps, [])
      } else {
        const prev = schedules.find(x => x.id === data.id)
        await api.updateSchedule(serverId, data.id, payload)
        if (prev) await syncTasks(data.id, data.steps, (prev.steps || []).map(st => st.id))
      }
      closeModal()
      await load()
    } catch (e) {
      const msg = e?.message || (lang === 'vi' ? 'Lỗi' : 'Error')
      setError(msg)
      showToast(msg, 'error')
    }
  }

  const handleToggle = async (s) => {
    setBusyId(s.id)
    try {
      const next = !(s.isActive !== false)
      await api.updateSchedule(
        serverId,
        s.id,
        api.isCalagopus() ? { enabled: next } : cronPayload(s.cronFields, s.name, next, s.only_when_online === true),
      )
      await load()
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
    } finally { setBusyId(null) }
  }

  const handleRun = async (s) => {
    setBusyId(s.id)
    try {
      await api.executeSchedule(serverId, s.id)
      await load()
    } catch (e) {
      const msg = e?.message || (lang === 'vi' ? 'Chạy thất bại' : 'Run failed')
      setError(msg)
      showToast(msg, 'error')
    } finally { setBusyId(null); closeMenu() }
  }

  const handleDelete = async (s) => {
    const ok = window.confirm(lang === 'vi' ? `Xóa lịch trình "${s.name}"?` : `Delete schedule "${s.name}"?`)
    if (!ok) return
    setBusyId(s.id)
    try {
      await api.deleteSchedule(serverId, s.id)
      setSchedules(prev => prev.filter(x => x.id !== s.id))
    } catch (e) {
      showToast(e?.message || (lang === 'vi' ? 'Xóa thất bại' : 'Delete failed'), 'error')
    } finally { setBusyId(null); closeMenu() }
  }

  const actionIcon = (action) => {
    if (action === 'power') return <Power size={13} weight="duotone" />
    if (action === 'backup') return <Archive size={13} weight="duotone" />
    return <Terminal size={13} weight="duotone" />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-4">
      <div className="flex items-center gap-3">
        <Clock size={16} weight="duotone" style={{ color: '#a78bfa' }} />
        <h2 className="text-sm font-bold" style={{ color: textColor }}>
          {lang === 'vi' ? 'Lịch trình' : 'Schedules'}
        </h2>
        <div className="flex-1" />
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80 active:scale-95"
          style={{ background: '#a78bfa', color: '#fff' }}
        >
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Tạo mới' : 'Create'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
          <Warning size={13} weight="duotone" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Clock size={28} weight="light" style={{ color: labelColor }} />
            <span className="text-[11px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Chưa có lịch trình' : 'No schedules yet'}
            </span>
            <span className="text-[10px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Tạo cron + multi-step: command, power, backup' : 'Create cron + multi-step: command, power, backup'}
            </span>
          </div>
        ) : schedules.map((s) => {
          const active = s.isActive !== false
          const running = !!s.isProcessing
          return (
            <div key={s.id} className="relative mb-2 px-3 py-2.5 rounded-xl" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(s)}
                  disabled={busyId === s.id}
                  title={active ? (lang === 'vi' ? 'Tắt' : 'Disable') : (lang === 'vi' ? 'Bật' : 'Enable')}
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all disabled:opacity-50"
                  style={{ background: active ? '#22c55e20' : '#6b728020' }}
                >
                  {active ? <Play size={12} weight="fill" style={{ color: '#22c55e' }} /> : <Pause size={12} weight="fill" style={{ color: '#9ca3af' }} />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold truncate" style={{ color: textColor }}>{s.name}</p>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{
                      background: running ? '#eab30820' : active ? '#22c55e15' : '#6b728020',
                      color: running ? '#eab308' : active ? '#22c55e' : '#9ca3af',
                    }}>
                      {running ? (lang === 'vi' ? 'Đang chạy' : 'Running') : active ? (lang === 'vi' ? 'Đang bật' : 'Active') : (lang === 'vi' ? 'Đã tắt' : 'Inactive')}
                    </span>
                    {s.lastStatus === 'failed' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#ef444420', color: '#ef4444' }}>
                        {lang === 'vi' ? 'Lỗi' : 'Failed'}
                      </span>
                    )}
                    {s.lastStatus === 'success' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#22c55e15', color: '#22c55e' }}>
                        OK
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-mono" style={{ color: '#a78bfa' }}>{s.cron}</span>
                    <span className="text-[10px]" style={{ color: labelColor }}>{s.humanCron || s.cron}</span>
                    <span className="text-[10px]" style={{ color: labelColor }}>
                      {lang === 'vi' ? 'Tiếp:' : 'Next:'} {formatTime(s.nextRunAt)}
                    </span>
                    <span className="text-[10px]" style={{ color: labelColor }}>
                      {lang === 'vi' ? 'Lần cuối:' : 'Last:'} {formatTime(s.lastRunAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {(s.steps || []).map((st, i) => (
                      <span key={st.id || i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded" style={{ background: inputBg, border: `1px solid ${borderColor}`, color: labelColor }}>
                        {actionIcon(st.action)}
                        {stepSummary(st, lang)}
                        {st.delay > 0 && <span style={{ color: '#f59e0b' }}>+{st.delay}s</span>}
                      </span>
                    ))}
                  </div>
                  {s.lastError && (
                    <p className="text-[10px] mt-1 truncate" style={{ color: '#ef4444' }}>{s.lastError}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleRun(s)}
                    disabled={busyId === s.id || running}
                    title={lang === 'vi' ? 'Chạy ngay' : 'Run now'}
                    className="p-1.5 rounded-lg transition-all disabled:opacity-40 hover:opacity-80"
                    style={{ background: '#3b82f620', color: '#3b82f6' }}
                  >
                    <Play size={13} weight="fill" />
                  </button>
                  <button
                    onClick={() => openEdit(s)}
                    title={lang === 'vi' ? 'Sửa' : 'Edit'}
                    className="p-1.5 rounded-lg transition-all hover:opacity-80"
                    style={{ background: '#a78bfa20', color: '#a78bfa' }}
                  >
                    <PencilSimple size={13} weight="duotone" />
                  </button>
                  <div>
                    <button
                      onClick={(e) => toggleMenu(e, s.id)}
                      className="p-1.5 rounded-lg transition-all hover:opacity-80"
                      style={{ background: cardBg, color: labelColor }}
                    >
                      <DotsThreeVertical size={13} weight="bold" />
                    </button>
                    {openMenu === s.id && menuPos && (
                      <>
                        <div className="fixed inset-0 z-[90]" onClick={closeMenu} />
                        <div
                          className="fixed z-[100] min-w-[140px] rounded-xl overflow-hidden shadow-xl"
                          style={{
                            top: menuPos.top,
                            right: menuPos.right,
                            background: modalBg,
                            border: `1px solid ${borderColor}`,
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleRun(s)}
                            disabled={running}
                            className="w-full px-3 py-2 text-left text-[11px] flex items-center gap-2 disabled:opacity-40"
                            style={{ color: textColor }}
                          >
                            <Play size={12} weight="fill" /> {lang === 'vi' ? 'Chạy ngay' : 'Run now'}
                          </button>
                          <button
                            onClick={() => { openEdit(s); closeMenu() }}
                            className="w-full px-3 py-2 text-left text-[11px] flex items-center gap-2"
                            style={{ color: textColor }}
                          >
                            <PencilSimple size={12} weight="duotone" /> {lang === 'vi' ? 'Sửa' : 'Edit'}
                          </button>
                          <button
                            onClick={() => handleDelete(s)}
                            className="w-full px-3 py-2 text-left text-[11px] flex items-center gap-2"
                            style={{ color: '#ef4444' }}
                          >
                            <Trash size={12} weight="duotone" /> {lang === 'vi' ? 'Xóa' : 'Delete'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {modalRender && viewModal && (
        <div
          className={`modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4${modalClosing ? ' closing' : ''}`}
          style={{
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            pointerEvents: modalClosing ? 'none' : 'auto',
          }}
          onClick={() => { if (!modalClosing) closeModal() }}
        >
          <div
            className={`modal-content w-full max-w-[560px] max-h-[85vh] rounded-2xl overflow-hidden flex flex-col${modalClosing ? ' closing' : ''}`}
            style={{ background: modalBg, border: `1px solid ${borderColor}` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${borderColor}` }}>
              <Clock size={15} weight="duotone" style={{ color: '#a78bfa' }} />
              <h3 className="text-xs font-bold" style={{ color: textColor }}>
                {viewModal.mode === 'create'
                  ? (lang === 'vi' ? 'Tạo lịch trình' : 'Create schedule')
                  : (lang === 'vi' ? 'Sửa lịch trình' : 'Edit schedule')}
              </h3>
              <div className="flex-1" />
              <button onClick={closeModal} className="p-1 rounded-lg" style={{ color: labelColor }}>
                <X size={15} weight="bold" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: labelColor }}>
                  {lang === 'vi' ? 'Tên' : 'Name'}
                </label>
                <input
                  value={viewModal.data.name}
                  onChange={e => updateData({ name: e.target.value })}
                  placeholder={lang === 'vi' ? 'Backup hàng đêm' : 'Nightly backup'}
                  className="w-full px-3 py-2 rounded-lg text-[11px] outline-none"
                  style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: labelColor }}>
                  Cron {lang === 'vi' ? '(5 trường: phút giờ ngày tháng thứ)' : '(5 fields: min hour dom month dow)'}
                </label>
                <input
                  value={viewModal.data.cron}
                  onChange={e => updateData({ cron: e.target.value })}
                  placeholder="*/5 * * * *"
                  className="w-full px-3 py-2 rounded-lg text-[11px] outline-none font-mono"
                  style={{ background: inputBg, border: `1px solid ${preview.valid || !viewModal.data.cron ? borderColor : '#ef444466'}`, color: textColor }}
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {PRESETS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => updateData({ cron: p.label })}
                      className="text-[9px] px-2 py-1 rounded-md font-mono transition-all hover:opacity-80"
                      style={{ background: viewModal.data.cron === p.label ? '#a78bfa25' : cardBg, border: `1px solid ${borderColor}`, color: viewModal.data.cron === p.label ? '#a78bfa' : labelColor }}
                      title={lang === 'vi' ? p.vi : p.en}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[10px]" style={{ color: labelColor }}>
                  <span style={{ color: preview.valid ? '#22c55e' : '#ef4444' }}>
                    {viewModal.data.cron
                      ? (preview.valid ? `✓ ${preview.human || preview.valid}` : (lang === 'vi' ? '✗ Cron không hợp lệ' : '✗ Invalid cron'))
                      : ''}
                  </span>
                  {preview.valid && preview.nextRunAt && (
                    <span>{lang === 'vi' ? 'Chạy tiếp theo:' : 'Next run:'} {formatTime(preview.nextRunAt)}</span>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: textColor }}>
                <input
                  type="checkbox"
                  checked={viewModal.data.isActive !== false}
                  onChange={e => updateData({ isActive: e.target.checked })}
                  className="rounded"
                />
                {lang === 'vi' ? 'Kích hoạt ngay' : 'Activate immediately'}
              </label>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: labelColor }}>
                    {lang === 'vi' ? `Các bước (${viewModal.data.steps.length})` : `Steps (${viewModal.data.steps.length})`}
                  </label>
                  <div className="flex-1" />
                  <button
                    onClick={addStep}
                    disabled={viewModal.data.steps.length >= MAX_TASKS}
                    title={viewModal.data.steps.length >= MAX_TASKS
                      ? (lang === 'vi' ? `Tối đa ${MAX_TASKS} bước mỗi lịch trình` : `${MAX_TASKS} steps per schedule max`)
                      : undefined}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-semibold disabled:opacity-40"
                    style={{ background: '#a78bfa20', color: '#a78bfa' }}
                  >
                    <Plus size={11} weight="bold" /> {lang === 'vi' ? 'Thêm bước' : 'Add step'}
                  </button>
                </div>

                <div className="space-y-2">
                  {viewModal.data.steps.map((st, idx) => (
                    <div key={st.id || idx} className="p-2.5 rounded-xl" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold w-5 text-center rounded" style={{ background: '#a78bfa20', color: '#a78bfa' }}>{idx + 1}</span>
                        <select
                          value={st.action}
                          onChange={e => updateStep(idx, { action: e.target.value })}
                          className="px-2 py-1 rounded-md text-[11px] outline-none"
                          style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                        >
                          {ACTION_OPTIONS.map(a => (
                            <option key={a.value} value={a.value}>{lang === 'vi' ? a.vi : a.label}</option>
                          ))}
                        </select>

                        <div className="flex-1" />

                        <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-1 disabled:opacity-30" style={{ color: labelColor }} title="Up">
                          <CaretLeft size={12} weight="bold" style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                        <button onClick={() => moveStep(idx, 1)} disabled={idx === viewModal.data.steps.length - 1} className="p-1 disabled:opacity-30" style={{ color: labelColor }} title="Down">
                          <CaretRight size={12} weight="bold" style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                        <button onClick={() => removeStep(idx)} disabled={viewModal.data.steps.length <= 1} className="p-1 disabled:opacity-30" style={{ color: '#ef4444' }} title="Remove">
                          <Trash size={12} weight="duotone" />
                        </button>
                      </div>

                      {st.action === 'command' && (
                        <input
                          value={st.command || ''}
                          onChange={e => updateStep(idx, { command: e.target.value })}
                          placeholder={lang === 'vi' ? 'Lệnh console, ví dụ: say hi' : 'Console command, e.g. say hi'}
                          className="w-full px-2.5 py-1.5 rounded-lg text-[11px] outline-none font-mono mb-2"
                          style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                        />
                      )}

                      {st.action === 'power' && (
                        <select
                          value={st.power || 'start'}
                          onChange={e => updateStep(idx, { power: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded-lg text-[11px] outline-none mb-2"
                          style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                        >
                          {POWER_OPTIONS.map(p => (
                            <option key={p.value} value={p.value}>{lang === 'vi' ? p.vi : p.en}</option>
                          ))}
                        </select>
                      )}

                      {st.action === 'backup' && (
                        <p className="text-[10px] mb-2" style={{ color: labelColor }}>
                          {lang === 'vi'
                            ? 'Nén thư mục server thành tar.gz trong backups/'
                            : 'Archive server folder to tar.gz under backups/'}
                        </p>
                      )}

                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-1.5 text-[10px]" style={{ color: labelColor }}>
                          {lang === 'vi' ? 'Delay (giây):' : 'Delay (sec):'}
                          <input
                            type="number"
                            min="0"
                            max="600"
                            value={st.delay || 0}
                            onChange={e => updateStep(idx, { delay: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
                            className="w-16 px-2 py-0.5 rounded-md text-[10px] outline-none font-mono"
                            style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: labelColor }}>
                          <input
                            type="checkbox"
                            checked={!!st.continueOnFailure}
                            onChange={e => updateStep(idx, { continueOnFailure: e.target.checked })}
                            className="rounded"
                          />
                          {lang === 'vi' ? 'Tiếp tục nếu lỗi' : 'Continue on failure'}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${borderColor}` }}>
              <div className="flex-1" />
              <button onClick={closeModal} disabled={modalClosing} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: borderColor, color: labelColor }}>
                {lang === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={handleSave} disabled={modalClosing} className="px-4 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#a78bfa', color: '#fff' }}>
                {lang === 'vi' ? 'Lưu' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
