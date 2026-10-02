import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash, Network, Star } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import * as api from '../../api/client.js'

export default function NetworkPage({ server, theme, lang, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const btn = 'p-1.5 rounded-lg transition-all duration-150 hover:opacity-80 active:scale-95'

  const [allocations, setAllocations] = useState(server?.allocations || [])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.listAllocations(server.id)
      setAllocations(rows)
      const primary = rows.find((a) => a.is_default)
      if (primary && (primary.port !== server?.port || primary.ip !== server?.ip)) {
        onServerUpdate?.({ ...server, port: primary.port, ip: primary.ip })
      }
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Không tải được phân bổ cổng' : 'Could not load allocations'), 'error')
    } finally {
      setLoading(false)
    }
  }, [server.id, server?.port, server?.ip, lang, onServerUpdate, server])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.createAllocation(server.id)
      showToast(lang === 'vi' ? 'Đã thêm phân bổ mới' : 'Allocation created', 'success')
      await load()
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Thêm thất bại' : 'Could not add an allocation'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handlePrimary = async (alloc) => {
    if (busy) return
    setBusy(true)
    try {
      await api.setPrimaryAllocation(server.id, alloc.id)
      showToast(lang === 'vi' ? 'Đã đặt làm cổng chính' : 'Primary allocation updated', 'success')
      await load()
    } catch (err) {
      showToast(err?.message || tFailed(lang), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (alloc) => {
    if (busy) return
    setBusy(true)
    try {
      await api.deleteAllocation(server.id, alloc.id)
      showToast(lang === 'vi' ? 'Đã xóa phân bổ' : 'Allocation deleted', 'success')
      await load()
    } catch (err) {
      showToast(err?.message || tFailed(lang), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Cổng mạng' : 'Network / Allocations'}</h2>
        <div className="flex-1" />
        <button
          onClick={handleAdd}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-60"
          style={{ background: '#8b5cf6', color: '#fff' }}
        >
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Thêm port' : 'Add allocation'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && allocations.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Đang tải…' : 'Loading…'}</span>
          </div>
        ) : allocations.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Chưa có phân bổ nào' : 'No allocations yet'}</span>
          </div>
        ) : allocations.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#22c55e20' }}>
              <Network size={14} weight="duotone" style={{ color: '#22c55e' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold font-mono truncate" style={{ color: textColor }}>
                {a.ip}{a.ip_alias ? ` (${a.ip_alias})` : ''}:{a.port}
              </p>
              <p className="text-[10px] truncate" style={{ color: labelColor }}>
                {a.is_default
                  ? (lang === 'vi' ? 'Cổng chính · TCP/UDP' : 'Primary · TCP/UDP')
                  : (a.notes || 'TCP/UDP')}
              </p>
            </div>
            {!a.is_default && (
              <>
                <button
                  onClick={() => handlePrimary(a)}
                  disabled={busy}
                  title={lang === 'vi' ? 'Đặt làm cổng chính' : 'Set as primary'}
                  className={btn}
                  style={{ color: '#f59e0b' }}
                >
                  <Star size={13} weight="duotone" />
                </button>
                <button
                  onClick={() => handleDelete(a)}
                  disabled={busy}
                  title={lang === 'vi' ? 'Xóa phân bổ' : 'Delete allocation'}
                  className={btn}
                  style={{ color: '#ef4444' }}
                >
                  <Trash size={13} weight="duotone" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function tFailed(lang) {
  return lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'
}
