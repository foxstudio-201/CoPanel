import { useState } from 'react'
import { Warning, Trash, ArrowClockwise, PencilSimple } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import { t } from '../../i18n/translations'
import * as api from '../../api/client.js'

const btn = 'px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 hover:opacity-80 active:scale-95'

export default function ServerSettingsPage({ server, theme, lang, onBack, onServerDeleted, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [name, setName] = useState(server?.name || '')
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleRename = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await api.renameServer(server.id, name.trim())
      showToast(lang === 'vi' ? 'Đã đổi tên server' : 'Server renamed', 'success')
      onServerUpdate?.({ ...server, name: name.trim() })
    } catch (err) {
      showToast(err?.message || t(lang, 'toast.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleReinstall = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.reinstallServer(server.id)
      showToast(t(lang, 'toast.reinstalling'), 'success')
      onServerUpdate?.({ ...server, status: 'installing', installProgress: 0 })
    } catch (err) {
      showToast(err?.message || t(lang, 'toast.failed'), 'error')
    } finally {
      setBusy(false)
      setShowReinstallConfirm(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-4 gap-4">
      <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Cài đặt server' : 'Server Settings'}</h2>

      {}
      <div className="p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <PencilSimple size={14} weight="duotone" style={{ color: '#a78bfa' }} />
          <label className="text-[11px] font-semibold" style={{ color: textColor }}>{lang === 'vi' ? 'Đổi tên' : 'Rename Server'}</label>
        </div>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className="flex-1 px-3 py-1.5 rounded-lg text-[11px] outline-none transition-colors focus:border-[#a78bfa]" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
          <button onClick={handleRename} className={`${btn}`} style={{ background: '#a78bfa', color: '#fff' }}>{lang === 'vi' ? 'Lưu' : 'Save'}</button>
        </div>
      </div>

      {}
      <div className="p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <ArrowClockwise size={14} weight="duotone" style={{ color: '#f59e0b' }} />
          <label className="text-[11px] font-semibold" style={{ color: textColor }}>{lang === 'vi' ? 'Cài lại server' : 'Reinstall Server'}</label>
        </div>
        <p className="text-[10px] mb-2" style={{ color: labelColor }}>{lang === 'vi' ? 'Chạy lại script cài đặt. Dữ liệu trong thư mục gốc sẽ bị xóa.' : 'Re-run the install script. Data in the root directory will be wiped.'}</p>
        {showReinstallConfirm ? (
          <div className="flex gap-2">
            <button onClick={handleReinstall} className={btn} style={{ background: '#f59e0b', color: '#fff' }}>{lang === 'vi' ? 'Xác nhận' : 'Confirm'}</button>
            <button onClick={() => setShowReinstallConfirm(false)} className={btn} style={{ background: borderColor, color: labelColor }}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
          </div>
        ) : (
          <button onClick={() => setShowReinstallConfirm(true)} className={btn} style={{ background: '#f59e0b20', color: '#f59e0b' }}>{lang === 'vi' ? 'Cài lại' : 'Reinstall'}</button>
        )}
      </div>

      {}
      <div className="p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <Warning size={14} weight="duotone" style={{ color: '#f59e0b' }} />
          <label className="text-[11px] font-semibold" style={{ color: textColor }}>{lang === 'vi' ? 'Xóa server' : 'Delete Server'}</label>
        </div>
        <p className="text-[10px]" style={{ color: labelColor }}>
          {lang === 'vi'
            ? 'Xóa server không khả dụng trong Client API — hãy xóa từ trang quản trị của panel (Admin → Servers).'
            : 'Deleting a server is not part of the Client API — use the panel admin area (Admin → Servers).'}
        </p>
      </div>
    </div>
  )
}
