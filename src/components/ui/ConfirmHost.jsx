import { useState, useEffect, useCallback, useRef } from 'react'
import { Warning, Trash, X } from '@phosphor-icons/react'
import { useApp } from '../../i18n/AppContext'
import { subscribeConfirm } from '../../lib/confirm'

const EXIT_MS = 180

const TONE = {
  danger: { color: '#ef4444', hover: 'rgba(239,68,68,0.85)', Icon: Trash },
  warning: { color: '#f59e0b', hover: 'rgba(245,158,11,0.85)', Icon: Warning },
  default: { color: '#a78bfa', hover: 'rgba(167,139,250,0.85)', Icon: Warning },
}

export default function ConfirmHost() {
  const { lang, theme } = useApp()
  const [req, setReq] = useState(null)
  const [closing, setClosing] = useState(false)
  const currentRef = useRef(null)

  useEffect(() => {
    const unsub = subscribeConfirm((next) => {
      if (currentRef.current) currentRef.current.resolve(false)
      currentRef.current = next
      setClosing(false)
      setReq(next)
    })
    return () => {
      unsub()
      if (currentRef.current) currentRef.current.resolve(false)
      currentRef.current = null
    }
  }, [])

  const settle = useCallback((result) => {
    const cur = currentRef.current
    if (!cur) return
    currentRef.current = null
    setClosing(true)
    setTimeout(() => {
      setReq((r) => (r && r.id === cur.id ? null : r))
      setClosing(false)
    }, EXIT_MS)
    cur.resolve(result)
  }, [])

  useEffect(() => {
    if (!req) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        settle(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        settle(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [req, settle])

  if (!req) return null

  const vi = lang === 'vi'
  const tone = TONE[req.tone] || TONE.danger
  const Icon = tone.Icon
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const modalBg = theme === 'light' ? '#fff' : '#141414'
  const cancelBg = theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'
  const cancelHover = theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.16)'

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-[95] flex items-center justify-center p-4${closing ? ' closing' : ''}`}
      style={{
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        pointerEvents: closing ? 'none' : 'auto',
      }}
      onClick={() => settle(false)}
    >
      <div
        className={`modal-content w-full max-w-[380px] rounded-2xl overflow-hidden${closing ? ' closing' : ''}`}
        style={{ background: modalBg, border: `1px solid ${borderColor}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 pt-4">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `${tone.color}22` }}
          >
            <Icon size={16} weight="duotone" style={{ color: tone.color }} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="text-[13px] font-bold leading-snug" style={{ color: textColor }}>
              {req.title || (vi ? 'Xác nhận' : 'Confirm')}
            </h3>
            {req.message ? (
              <p className="text-[12px] mt-1 leading-relaxed break-words" style={{ color: labelColor }}>
                {req.message}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => settle(false)}
            className="p-1 rounded-lg shrink-0 transition-opacity hover:opacity-70"
            style={{ color: labelColor }}
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-4">
          <button
            type="button"
            onClick={() => settle(false)}
            className="px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors"
            style={{ background: cancelBg, color: textColor }}
            onMouseEnter={(e) => { e.currentTarget.style.background = cancelHover }}
            onMouseLeave={(e) => { e.currentTarget.style.background = cancelBg }}
          >
            {req.cancelLabel || (vi ? 'Huỷ' : 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className="px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors"
            style={{ background: tone.color, color: '#fff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = tone.hover }}
            onMouseLeave={(e) => { e.currentTarget.style.background = tone.color }}
          >
            {req.confirmLabel || (vi ? 'Xác nhận' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
