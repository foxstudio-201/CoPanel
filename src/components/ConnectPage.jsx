import { useState, useEffect } from 'react'
import { useApp } from '../i18n/AppContext'
import { connectWithApiKey, normalizeUrl, startDemo, detectPanelType } from '../api/session'

function Field({ label, children, hint }) {
  const { theme } = useApp()
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  return (
    <div>
      <label className="block text-[13px] mb-1.5 font-medium" style={{ color: labelColor }}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: labelColor }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function Spinner({ theme }) {
  const stroke = theme === 'light' ? '#111' : '#fff'
  return (
    <svg className="w-4 h-4 animate-spin shrink-0" viewBox="0 0 50 50">
      <circle cx="25" cy="25" r="20" fill="none" stroke={theme === 'light' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)'} strokeWidth="5" />
      <path d="M25 5 A20 20 0 0 1 45 25" fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

const PANEL_META = {
  pterodactyl: { color: '#a78bfa', label: 'Pterodactyl' },
  calagopus: { color: '#22d3ee', label: 'Calagopus' },
}
const DEFAULT_COLOR = '#a78bfa'


export default function ConnectPage({ onConnected }) {
  const { lang, theme } = useApp()

  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)

  const detected = detectPanelType(apiKey)
  const meta = PANEL_META[detected] || { color: DEFAULT_COLOR, label: '' }
  const bg = theme === 'light' ? '#f5f5f5' : '#0a0a0a'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const inputBg = theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'
  const inputBorder = theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'

  const inputStyle = {
    background: inputBg,
    border: `1px solid ${inputBorder}`,
    color: textColor,
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!window.electronAPI) return
      try {
        const settings = await window.electronAPI.getSettings()
        if (!cancelled && settings?.panel?.url) setUrl(settings.panel.url)
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (loading) return
    setError('')

    const origin = normalizeUrl(url)
    if (!origin) {
      setError(lang === 'vi' ? 'Nhập địa chỉ panel hợp lệ, ví dụ https://panel.example.com' : 'Enter a valid panel URL, e.g. https://panel.example.com')
      return
    }

    setLoading(true)
    try {
      const result = await connectWithApiKey({ url: origin, apiKey })

      if (!result.ok) setError(result.error || 'Connection failed.')
      else onConnected?.(result.account)
    } catch (err) {
      setError(err?.message || 'Connection failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleDemo = async () => {
    if (demoBusy) return
    setError('')
    setDemoBusy(true)
    try {
      const result = await startDemo()
      if (result.ok) onConnected?.(result.account)
    } finally {
      setDemoBusy(false)
    }
  }

  const hintText = (() => {
    if (detected === 'calagopus') {
      return lang === 'vi'
        ? 'Tạo tại panel: Tài khoản → API Keys → Create. Key dài 48 ký tự, bắt đầu bằng c7sp_. Nhớ cấp quyền cho key (ít nhất servers.read).'
        : 'Create it on the panel under Account → API Keys → Create. The key is 48 characters, starts with c7sp_. Remember to grant permissions (at least servers.read).'
    }
    if (detected === 'pterodactyl') {
      return lang === 'vi'
        ? 'Tạo tại panel: Account → API Credentials → Create API Key. Bắt đầu bằng ptlc_.'
        : 'Create it on the panel under Account → API Credentials. It starts with ptlc_.'
    }
    return lang === 'vi'
      ? 'Dán Client API Key — Pterodactyl bắt đầu bằng ptlc_, Calagopus bằng c7sp_. CoPanel tự nhận diện loại panel.'
      : 'Paste a Client API key — Pterodactyl keys start with ptlc_, Calagopus keys with c7sp_. The panel type is detected automatically.'
  })()

  return (
    <div data-surface className="flex items-center justify-center w-full h-full" style={{ background: bg }}>
      <div className="relative z-10 w-full max-w-md p-8 overflow-y-auto max-h-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2" style={{ color: textColor }}>
            {lang === 'vi' ? 'Kết nối tới panel' : 'Connect to your panel'}
          </h1>
          <p className="text-xs" style={{ color: labelColor }}>
            {lang === 'vi'
              ? 'Nhập địa chỉ panel và Client API Key — loại panel được nhận diện tự động.'
              : 'Enter your panel address and a Client API key — the panel type is detected automatically.'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div
              className="p-3 rounded-lg text-xs leading-relaxed"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
            >
              {error}
            </div>
          )}

          <Field label={lang === 'vi' ? 'Địa chỉ panel' : 'Panel URL'}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none focus:border-purple-500/60 transition-colors"
              style={inputStyle}
              placeholder="https://panel.example.com"
              spellCheck={false}
              autoComplete="off"
              required
            />
          </Field>

          <Field
            label="Client API Key"
            hint={
              <span>
                {detected ? (
                  <span className="font-semibold" style={{ color: meta.color }}>
                    {lang === 'vi' ? 'Đã nhận diện' : 'Detected'}: {meta.label} —{' '}
                  </span>
                ) : null}
                {hintText}
              </span>
            }
          >
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none font-mono focus:border-purple-500/60 transition-colors"
              style={inputStyle}
              placeholder="ptlc_… hoặc c7sp_…"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: meta.color, color: '#0a0a0a' }}
          >
            {loading && <Spinner theme={theme} />}
            {loading
              ? lang === 'vi'
                ? 'Đang kết nối…'
                : 'Connecting…'
              : lang === 'vi'
                ? 'Kết nối'
                : 'Connect'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleDemo}
          disabled={demoBusy}
          className="w-full mt-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
          style={{ background: 'transparent', border: `1px dashed ${meta.color}66`, color: meta.color }}
        >
          {demoBusy
            ? (lang === 'vi' ? 'Đang mở chế độ demo…' : 'Opening the demo…')
            : lang === 'vi'
              ? 'Dùng thử ngay — xem giao diện với dữ liệu mẫu'
              : 'Try the demo — explore with sample data'}
        </button>

        <div className="mt-5 text-center text-[11px]" style={{ color: labelColor }}>
          <span className="font-mono opacity-60">v1.0.0</span>
        </div>
      </div>
    </div>
  )
}
