import { useState, useEffect, useRef, useCallback } from 'react'
import { User, Trash, Plus, Check, X, CaretDown } from '@phosphor-icons/react'
import { listAccounts, deleteAccount, switchAccount } from '../api/session'

const PANEL_COLOR = { pterodactyl: '#a78bfa', calagopus: '#22d3ee' }
const DD_MS = 200
const DD_OUT_MS = 160

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return String(url || '').replace(/^https?:\/\//, '')
  }
}

export default function AccountSwitcher({ session, lang, theme, onAddAccount }) {
  const isDark = theme !== 'light'
  const vi = lang === 'vi'

  const [open, setOpen] = useState(false)
  const [render, setRender] = useState(false)
  const [phase, setPhase] = useState('in')
  const [accounts, setAccounts] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  const rootRef = useRef(null)

  const account = session?.account || null

  const refresh = useCallback(async () => {
    try {
      setAccounts(await listAccounts())
    } catch {
      setAccounts([])
    }
  }, [])

  useEffect(() => {
    if (open) {
      refresh()
      setConfirmId(null)
      setPhase('in')
      setRender(true)
    }
  }, [open, refresh])

  useEffect(() => {
    if (open || !render) return
    setPhase('out')
    const t = setTimeout(() => setRender(false), DD_OUT_MS)
    return () => clearTimeout(t)
  }, [open, render])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSwitch = async (id) => {
    if (busyId) return
    setBusyId(id)
    const res = await switchAccount(id)
    if (res?.ok) setOpen(false)
    else await refresh()
    setBusyId(null)
  }

  const handleDelete = async (id) => {
    if (busyId) return
    setBusyId(id)
    await deleteAccount(id)
    await refresh()
    setConfirmId(null)
    setBusyId(null)
  }

  if (!account) return null

  const accent = PANEL_COLOR[session?.panelType] || '#a78bfa'
  const userBg = isDark ? 'rgba(167,139,250,0.15)' : 'rgba(139,92,246,0.12)'
  const userColor = isDark ? '#a78bfa' : '#7c3aed'
  const usernameColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'
  const labelColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'
  const strongColor = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)'
  const ddBg = isDark ? 'rgba(20,20,22,0.98)' : 'rgba(255,255,255,0.98)'
  const ddBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const rowHover = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
  const rowActive = isDark ? 'rgba(167,139,250,0.12)' : 'rgba(139,92,246,0.1)'
  const divider = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const triggerHover = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'

  return (
    <div ref={rootRef} className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 pl-1 pr-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        style={{ background: open ? triggerHover : 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = triggerHover }}
        onMouseLeave={(e) => { e.currentTarget.style.background = open ? triggerHover : 'transparent' }}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: userBg }}>
          <User size={18} weight="duotone" style={{ color: userColor }} />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-[11px] font-semibold leading-tight" style={{ color: usernameColor }}>
            {vi ? 'Đã kết nối' : 'Connected as'}
          </span>
          <span className="text-[13px] font-bold leading-tight" style={{ color: strongColor }}>
            {account.username || account.email || ''}
          </span>
        </div>
        <CaretDown
          size={12}
          weight="bold"
          style={{
            color: labelColor,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform ${DD_MS}ms cubic-bezier(0.33, 0, 0.2, 1)`,
          }}
        />
      </button>

      {render && (
        <div
          className={`acct-dd absolute left-0 ${phase}`}
          style={{
            top: 'calc(100% + 6px)',
            width: '236px',
            zIndex: 10000,
          }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: ddBg,
              border: `1px solid ${ddBorder}`,
              boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.55)' : '0 12px 32px rgba(0,0,0,0.16)',
            }}
          >
            <div className="px-3 pt-2.5 pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider truncate block" style={{ color: labelColor }}>
                {vi ? 'Tài khoản đã lưu' : 'Saved accounts'}
              </span>
            </div>

            <div className="overflow-y-auto overflow-x-hidden px-1.5" style={{ maxHeight: '83px' }}>
              {accounts.length === 0 && (
                <div className="px-2.5 py-3 text-[11px]" style={{ color: labelColor }}>
                  {vi ? 'Chưa có tài khoản nào.' : 'No saved accounts yet.'}
                </div>
              )}

              {accounts.map((a) => {
                const isCurrent = !!session?.accountId && session.accountId === a.id
                const isBusy = busyId === a.id
                const confirming = confirmId === a.id
                const aColor = PANEL_COLOR[a.panelType] || '#a78bfa'

                return (
                  <div
                    key={a.id}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded-lg mb-0.5 transition-colors"
                    style={{ background: isCurrent ? rowActive : 'transparent' }}
                    onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = rowHover }}
                    onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent' }}
                  >
                    <button
                      type="button"
                      onClick={() => !isCurrent && handleSwitch(a.id)}
                      disabled={isBusy || confirming}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default"
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: `${aColor}22` }}
                      >
                        <User size={13} weight="duotone" style={{ color: aColor }} />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[12px] font-semibold leading-tight truncate" style={{ color: strongColor }}>
                          {a.account?.username || a.account?.email || a.label || '—'}
                        </span>
                        <span className="text-[10px] leading-tight truncate" style={{ color: labelColor }}>
                          {hostOf(a.url)}
                        </span>
                      </div>
                    </button>

                    {isCurrent ? (
                      <span className="flex items-center gap-1 text-[9px] font-semibold shrink-0" style={{ color: '#22c55e' }}>
                        <Check size={11} weight="bold" />
                        {vi ? 'Đang dùng' : 'Active'}
                      </span>
                    ) : confirming ? (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDelete(a.id)}
                          disabled={isBusy}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: '#fff', background: '#ef4444' }}
                          data-tip={vi ? 'Xác nhận xoá' : 'Confirm'}
                        >
                          <Check size={12} weight="bold" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: labelColor }}
                          data-tip={vi ? 'Huỷ' : 'Cancel'}
                        >
                          <X size={12} weight="bold" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(a.id)}
                        className="w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                        style={{ color: labelColor }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = labelColor }}
                        data-tip={vi ? 'Xoá tài khoản' : 'Remove account'}
                      >
                        <Trash size={13} weight="duotone" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ borderTop: `1px solid ${divider}` }}>
              <button
                type="button"
                onClick={() => { setOpen(false); onAddAccount?.() }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] font-semibold cursor-pointer transition-colors"
                style={{ color: accent }}
                onMouseEnter={(e) => { e.currentTarget.style.background = rowHover }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Plus size={14} weight="bold" />
                {vi ? 'Thêm tài khoản' : 'Add account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
