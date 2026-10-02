import { useState } from 'react'
import {
  Globe, Palette, LinkSimple, PlugsConnected, ArrowClockwise, SignOut, Info, Cpu,
  CheckCircle, Moon, Sun, ShieldCheck, Sparkle,
} from '@phosphor-icons/react'
import { useApp } from '../i18n/AppContext'
import { getSession, setCpuThreads } from '../api/store.js'

const ACCENT = '#a78bfa'


export default function SettingsPage({ theme, lang, session, panelType, servers, version, onDisconnect, onChangePanelType, onReconnect }) {
  const { setLang, setTheme } = useApp()
  const [busy, setBusy] = useState(false)
  const [draftThreads, setDraftThreads] = useState(() => String(getSession().cpuThreads || 0))
  const [savedNote, setSavedNote] = useState('')

  const isLight = theme === 'light'
  const textColor = isLight ? '#111' : '#fff'
  const labelColor = isLight ? '#555' : 'rgba(255,255,255,0.6)'
  const mutedColor = isLight ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)'
  const bg = isLight ? '#f5f5f5' : '#0a0a0a'
  const cardBg = isLight ? '#fff' : '#111111'
  const softBg = isLight ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)'
  const borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const inputBorder = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'

  const panelLabel = panelType === 'calagopus' ? 'Calagopus' : 'Pterodactyl'
  const connected = session?.status === 'connected'
  const account = session?.account?.email || session?.account?.username || ''
  const statusText = connected
    ? (lang === 'vi' ? 'Đã kết nối' : 'Connected')
    : session?.status === 'connecting'
      ? (lang === 'vi' ? 'Đang kết nối…' : 'Connecting…')
      : (lang === 'vi' ? 'Chưa kết nối' : 'Disconnected')
  const statusColor = connected ? '#22c55e' : session?.status === 'connecting' ? '#eab308' : '#6b7280'

  const saveThreads = async () => {
    const n = Math.max(0, Math.min(1024, Math.floor(Number(draftThreads) || 0)))
    setDraftThreads(String(n))
    setCpuThreads(n)
    try {
      const s = (await window.electronAPI?.getSettings?.()) || {}
      await window.electronAPI?.saveSettings?.({ ...s, cpuThreads: n })
    } catch {  }
    setSavedNote(
      n > 0
        ? (lang === 'vi' ? `Đã lưu — CPU hiện theo % trên ${n} luồng.` : `Saved — CPU now shown as percent of ${n} threads.`)
        : (lang === 'vi' ? 'Đã lưu — CPU theo thang % của 1 nhân (mặc định).' : 'Saved — CPU back to the per-core scale (default).'),
    )
  }

  const previewThreads = Number(draftThreads) > 0 ? Math.max(1, Math.floor(Number(draftThreads))) : 8
  const previewPct = (100 / previewThreads).toFixed(2)

  const doReconnect = async () => {
    setBusy(true)
    try {
      await onReconnect?.()
    } finally {
      setBusy(false)
    }
  }

  const cardStyle = { background: cardBg, border: `1px solid ${borderColor}` }

  const LIGHT_TONE = {
    '#a78bfa': '#7c3aed',
    '#22d3ee': '#0e7490',
    '#ef4444': '#dc2626',
    '#3b82f6': '#2563eb',
    '#eab308': '#a16207',
    '#22c55e': '#15803d',
    '#f59e0b': '#b45309',
  }
  const tone = (color) => (isLight ? LIGHT_TONE[color] || color : color)

  const cardHeader = (Icon, iconColor, title, hint) => (
    <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: softBg }}>
        <Icon size={15} weight="duotone" style={{ color: iconColor }} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold leading-tight" style={{ color: textColor }}>{title}</h2>
        {hint ? <p className="text-[11px] mt-0.5 leading-snug" style={{ color: mutedColor }}>{hint}</p> : null}
      </div>
    </div>
  )

  const segmented = ({ options, value, onChange, ariaLabel }) => (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex p-1 rounded-xl gap-1"
      style={{ background: softBg, border: `1px solid ${borderColor}` }}
    >
      {options.map((opt) => {
        const active = opt.value === value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
            style={{
              background: active ? (isLight ? 'rgba(139,92,246,0.12)' : 'rgba(167,139,250,0.16)') : 'transparent',
              color: active ? (isLight ? '#7c3aed' : ACCENT) : labelColor,
              boxShadow: active ? `inset 0 0 0 1px ${isLight ? 'rgba(139,92,246,0.35)' : 'rgba(167,139,250,0.4)'}` : 'none',
            }}
          >
            {Icon ? <Icon size={14} weight={active ? 'fill' : 'duotone'} /> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )

  const badge = (text, color, Icon) => (
    <span
      key={text}
      className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md text-[10px] font-semibold"
      style={{ background: `${tone(color)}1f`, color: tone(color), border: `1px solid ${tone(color)}33` }}
    >
      {Icon ? <Icon size={11} weight="bold" /> : null}
      {text}
    </span>
  )

  const actionButton = ({ Icon, label, color, onClick, disabled, primary }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
      style={
        primary
          ? { background: tone(color), color: isLight ? '#fff' : '#0a0a0a' }
          : { background: `${tone(color)}1a`, color: tone(color), border: `1px solid ${tone(color)}40` }
      }
    >
      <Icon size={14} weight="duotone" />
      {label}
    </button>
  )

  return (
    <div data-surface className="h-full overflow-y-auto" style={{ background: bg }}>
      <div className="max-w-3xl mx-auto px-5 py-5 flex flex-col gap-4">
        {}
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight" style={{ color: textColor }}>
              {lang === 'vi' ? 'Hệ thống' : 'System'}
            </h1>
            <p className="text-xs mt-1" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Cấu hình ứng dụng và thông tin kết nối.' : 'Application preferences and connection details.'}
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0"
            style={{ background: `${tone(statusColor)}1a`, color: tone(statusColor), border: `1px solid ${tone(statusColor)}40` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
            {statusText}
          </span>
        </header>

        {}
        <section className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="p-4 flex items-start gap-3.5">
            <span
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${ACCENT}24`, border: `1px solid ${ACCENT}33` }}
            >
              <LinkSimple size={19} weight="duotone" style={{ color: ACCENT }} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-[15px] font-bold leading-none mr-0.5" style={{ color: textColor }}>{panelLabel}</h2>
                {session?.apiKey ? badge('API Key', ACCENT, ShieldCheck) : null}
                {session?.account?.root_admin ? badge(lang === 'vi' ? 'Quản trị' : 'Root admin', '#f59e0b') : null}
              </div>
              <p className="text-xs font-mono mt-1.5 truncate" style={{ color: labelColor }} title={session?.url || ''}>
                {session?.url || '—'}
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3">
                <span className="text-[11px]" style={{ color: mutedColor }}>
                  {lang === 'vi' ? 'Tài khoản' : 'Account'}{' '}
                  <span style={{ color: textColor }}>{account || '—'}</span>
                </span>
                <span className="text-[11px]" style={{ color: mutedColor }}>
                  {lang === 'vi' ? 'Số server' : 'Servers'}{' '}
                  <span style={{ color: textColor }}>{servers?.length ?? 0}</span>
                </span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${borderColor}`, background: isLight ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.02)' }}>
            <div className="px-3.5 py-2.5 flex flex-wrap items-center gap-2">
              {actionButton({
                Icon: ArrowClockwise,
                label: busy ? (lang === 'vi' ? 'Đang tải…' : 'Loading…') : (lang === 'vi' ? 'Tải lại danh sách' : 'Reload servers'),
                color: ACCENT,
                primary: true,
                onClick: doReconnect,
                disabled: busy,
              })}
              {actionButton({
                Icon: PlugsConnected,
                label: lang === 'vi' ? 'Kết nối panel khác' : 'Switch panel',
                color: '#22d3ee',
                onClick: onChangePanelType,
              })}
              <span className="flex-1" />
              {actionButton({
                Icon: SignOut,
                label: lang === 'vi' ? 'Ngắt kết nối' : 'Disconnect',
                color: '#ef4444',
                onClick: onDisconnect,
              })}
            </div>
          </div>
        </section>

        {}
        <div className="grid grid-cols-2 gap-4">
          <section className="rounded-2xl" style={cardStyle}>
            {cardHeader(Palette, tone('#eab308'), lang === 'vi' ? 'Giao diện' : 'Appearance', lang === 'vi' ? 'Chế độ sáng / tối của ứng dụng.' : 'Light or dark app theme.')}
            <div className="px-4 pb-4">
              {segmented({
                ariaLabel: lang === 'vi' ? 'Giao diện' : 'Appearance',
                value: theme,
                onChange: setTheme,
                options: [
                  { value: 'dark', label: lang === 'vi' ? 'Tối' : 'Dark', icon: Moon },
                  { value: 'light', label: lang === 'vi' ? 'Sáng' : 'Light', icon: Sun },
                ],
              })}
            </div>
          </section>

          <section className="rounded-2xl" style={cardStyle}>
            {cardHeader(Globe, tone('#3b82f6'), lang === 'vi' ? 'Ngôn ngữ' : 'Language', lang === 'vi' ? 'Ngôn ngữ hiển thị của giao diện.' : 'Interface language.')}
            <div className="px-4 pb-4">
              {segmented({
                ariaLabel: lang === 'vi' ? 'Ngôn ngữ' : 'Language',
                value: lang,
                onChange: setLang,
                options: [
                  { value: 'vi', label: 'Tiếng Việt' },
                  { value: 'en', label: 'English' },
                ],
              })}
            </div>
          </section>
        </div>

        {}
        <section className="rounded-2xl" style={cardStyle}>
          {cardHeader(
            Cpu,
            tone('#3b82f6'),
            lang === 'vi' ? 'Thang CPU' : 'CPU scale',
            lang === 'vi'
              ? 'Panel báo CPU theo % của 1 nhân; nhập số luồng của node để quy về % toàn hệ thống (trùng thang với spark).'
              : 'Panels report CPU per core; enter the node thread count to show system-wide percent (the same scale spark uses).',
          )}
          <div className="px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="relative inline-flex items-center">
                <span className="sr-only">{lang === 'vi' ? 'Số luồng CPU của node' : 'Node CPU threads'}</span>
                <input
                  type="number"
                  min="0"
                  max="1024"
                  value={draftThreads}
                  onChange={(e) => { setDraftThreads(e.target.value); setSavedNote('') }}
                  className="w-28 pl-3 pr-12 py-2 rounded-lg text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
                  style={{ background: softBg, color: textColor, border: `1px solid ${inputBorder}` }}
                />
                <span className="absolute right-3 text-[10px] font-medium pointer-events-none" style={{ color: mutedColor }}>
                  {lang === 'vi' ? 'luồng' : 'threads'}
                </span>
              </label>
              {actionButton({
                Icon: CheckCircle,
                label: lang === 'vi' ? 'Lưu' : 'Save',
                color: '#3b82f6',
                primary: true,
                onClick: saveThreads,
              })}
              {savedNote ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: '#22c55e' }}>
                  <CheckCircle size={12} weight="fill" /> {savedNote}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: mutedColor }}>
              {lang === 'vi'
                ? `Ví dụ: node ${previewThreads} luồng → 100% của 1 nhân = ${previewPct}%. Để 0 để tắt (giữ nguyên thang của panel).`
                : `Example: on a ${previewThreads}-thread node, 100% of one core = ${previewPct}%. Set 0 to turn this off (keep the panel's scale).`}
            </p>
          </div>
        </section>

        {}
        <section className="rounded-2xl" style={cardStyle}>
          {cardHeader(Info, tone('#22c55e'), lang === 'vi' ? 'Về ứng dụng' : 'About')}
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs leading-relaxed" style={{ color: labelColor }}>
              {lang === 'vi'
                ? 'CoPanel là ứng dụng client kết nối tới panel Pterodactyl / Calagopus. Mọi dữ liệu (console, trạng thái, tệp tin, backup…) đọc trực tiếp từ API của panel mà bạn cung cấp — CoPanel không lưu trữ dữ liệu server.'
                : 'CoPanel is a client for Pterodactyl / Calagopus panels. All data (console, status, files, backups…) is read straight from the panel API you provide — CoPanel stores no server data of its own.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['Client API', 'WebSocket Console', 'Files', 'Databases', 'Schedules', 'Backups', 'Allocations', 'Subusers'].map((x) => (
                <span
                  key={x}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-medium"
                  style={{ background: `${ACCENT}14`, color: isLight ? '#7c3aed' : ACCENT }}
                >
                  <Sparkle size={10} weight="fill" />
                  {x}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1" style={{ borderTop: `1px solid ${borderColor}` }}>
              <span className="text-[10px] pt-2.5 font-mono" style={{ color: mutedColor }}>
                CoPanel · v{version || '1.0.0'}
              </span>
              <span className="text-[10px] pt-2.5" style={{ color: mutedColor }}>
                Pterodactyl · Calagopus
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
