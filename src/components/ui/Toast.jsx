import { useState, useEffect } from 'react'

function Toast({ message, type = 'info', duration = 5000, onClose, action, actionLabel }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onClose?.(), 300)
    }, duration)
    return () => clearTimeout(timer)
  }, [duration, onClose])

  const colors = {
    info: { bg: '#2496ed', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    warning: { bg: '#f59e0b', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    success: { bg: '#22c55e', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    error: { bg: '#ef4444', icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z' },
  }

  const c = colors[type] || colors.info

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg transition-all duration-300"
      style={{
        background: theme => theme === 'light' ? '#fff' : '#1a1a1a',
        border: `1px solid ${c.bg}30`,
        transform: visible ? 'translateX(0)' : 'translateX(120%)',
        opacity: visible ? 1 : 0,
        minWidth: '300px',
        maxWidth: '400px',
      }}
    >
      <svg className="w-5 h-5 shrink-0" style={{ color: c.bg }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={c.icon} />
      </svg>
      <span className="text-xs flex-1" style={{ color: 'var(--text-color)' }}>{message}</span>
      {action && (
        <button
          onClick={action}
          className="px-3 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-colors"
          style={{ background: `${c.bg}20`, color: c.bg }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export default Toast
