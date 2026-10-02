import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash, Shield, X, Check, PencilSimple } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import * as api from '../../api/client.js'

const btn = 'px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 hover:opacity-80 active:scale-95'

export default function UserPage({ server, theme, lang, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const surface = theme === 'light' ? '#fff' : '#1a1a1a'

  const [users, setUsers] = useState([])
  const [permissions, setPermissions] = useState({}) 
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) 
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await api.listUsers(server.id))
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Không tải được danh sách người dùng' : 'Could not load subusers'), 'error')
    } finally {
      setLoading(false)
    }
  }, [server.id, lang])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let alive = true
    api.getPermissions()
      .then((json) => { if (alive) setPermissions(json?.attributes?.permissions || json?.permissions || {}) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const allKeys = Object.entries(permissions).flatMap(([group, def]) =>
    Object.keys(def?.keys || {}).map((key) => ({ id: `${group}.${key}`, group, label: def.keys[key] })),
  )

  const openAdd = () => {
    setEmail('')
    setModal({ mode: 'add', selected: new Set(['websocket.connect', 'control.console']) })
  }

  const openEdit = (user) => {
    setModal({ mode: 'edit', uuid: user.uuid, email: user.email, selected: new Set(user.permissions || []) })
  }

  const toggleKey = (id) => {
    setModal((m) => {
      const next = new Set(m.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...m, selected: next }
    })
  }

  const submitModal = async () => {
    if (busy) return
    const permissionsList = [...modal.selected]
    if (modal.mode === 'add' && !email.trim()) return
    if (modal.mode === 'add' && permissionsList.length === 0) {
      showToast(lang === 'vi' ? 'Chọn ít nhất một quyền' : 'Pick at least one permission', 'error')
      return
    }
    setBusy(true)
    try {
      if (modal.mode === 'add') {
        await api.createUser(server.id, { email: email.trim(), permissions: permissionsList })
        showToast(lang === 'vi' ? 'Đã thêm người dùng' : 'Subuser added', 'success')
      } else {
        await api.updateUser(server.id, modal.uuid, { permissions: permissionsList })
        showToast(lang === 'vi' ? 'Đã cập nhật quyền' : 'Permissions updated', 'success')
      }
      setModal(null)
      await load()
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (user) => {
    if (busy) return
    setBusy(true)
    try {
      await api.deleteUser(server.id, user.uuid)
      showToast(lang === 'vi' ? 'Đã xóa người dùng' : 'Subuser removed', 'success')
      await load()
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Không xóa được' : 'Could not remove the subuser'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Người dùng' : 'Subusers'}</h2>
        <div className="flex-1" />
        <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#8b5cf6', color: '#fff' }}>
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Thêm' : 'Add'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Đang tải…' : 'Loading…'}</span>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Shield size={40} weight="duotone" style={{ color: labelColor, opacity: 0.3 }} />
            <p className="text-[11px] mt-2" style={{ color: labelColor }}>{lang === 'vi' ? 'Chỉ có bạn truy cập server này' : 'Only you have access to this server'}</p>
          </div>
        ) : users.map((u) => (
          <div key={u.uuid || u.email} className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: '#8b5cf620' }}>
              {u.image ? (
                <img src={u.image} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] font-bold" style={{ color: '#8b5cf6' }}>
                  {(u.username || u.email || '?').slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold truncate" style={{ color: textColor }}>{u.username || u.email}</p>
              <p className="text-[10px] truncate" style={{ color: labelColor }}>
                {u.email} · {(u.permissions || []).length} {lang === 'vi' ? 'quyền' : 'permissions'}
              </p>
            </div>
            <button onClick={() => openEdit(u)} title={lang === 'vi' ? 'Sửa quyền' : 'Edit permissions'} className="p-1.5 rounded-lg transition-all hover:opacity-80" style={{ color: '#a78bfa' }}>
              <PencilSimple size={13} weight="duotone" />
            </button>
            <button onClick={() => handleDelete(u)} title={lang === 'vi' ? 'Xóa' : 'Remove'} className="p-1.5 rounded-lg transition-all hover:opacity-80" style={{ color: '#ef4444' }}>
              <Trash size={13} weight="duotone" />
            </button>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-[520px] max-w-[92vw] max-h-[80vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: surface, border: `1px solid ${borderColor}` }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${borderColor}` }}>
              <Shield size={15} weight="duotone" style={{ color: '#a78bfa' }} />
              <p className="text-xs font-bold" style={{ color: textColor }}>
                {modal.mode === 'add'
                  ? (lang === 'vi' ? 'Thêm người dùng' : 'Add subuser')
                  : (lang === 'vi' ? 'Quyền truy cập' : 'Permissions')}
              </p>
              <div className="flex-1" />
              <button onClick={() => setModal(null)} className="p-1 rounded-lg hover:opacity-70" style={{ color: labelColor }}>
                <X size={14} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {modal.mode === 'add' && (
                <div className="mb-3">
                  <label className="text-[11px] font-semibold mb-1 block" style={{ color: labelColor }}>{lang === 'vi' ? 'Email' : 'Email'}</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full px-3 py-2 rounded-lg text-[11px] outline-none focus:border-[#8b5cf6]"
                    style={{ background: theme === 'light' ? '#f7f7f7' : '#111', border: `1px solid ${borderColor}`, color: textColor }}
                  />
                  <p className="text-[10px] mt-1" style={{ color: labelColor }}>
                    {api.isCalagopus()
                      ? lang === 'vi'
                        ? 'Calagopus: email chưa có tài khoản sẽ được panel tự tạo. Chỉ người được thêm vào server này mới hiện trong danh sách.'
                        : 'Calagopus: the panel creates the account when the email is new. Only users added to this server appear here.'
                      : lang === 'vi'
                        ? 'Người dùng phải đã có tài khoản trên panel.'
                        : 'The account must already exist on the panel.'}
                  </p>
                </div>
              )}

              {allKeys.length === 0 ? (
                <p className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Đang tải quyền…' : 'Loading permissions…'}</p>
              ) : (
                Object.entries(permissions).map(([group, def]) => (
                  <div key={group} className="mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: labelColor }}>{group}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {Object.keys(def?.keys || {}).map((key) => {
                        const id = `${group}.${key}`
                        const on = modal.selected.has(id)
                        return (
                          <button
                            key={id}
                            onClick={() => toggleKey(id)}
                            title={def.keys[key]}
                            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-left transition-all"
                            style={{
                              background: on ? 'rgba(167,139,250,0.14)' : (theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'),
                              border: `1px solid ${on ? 'rgba(167,139,250,0.4)' : borderColor}`,
                              color: on ? '#a78bfa' : labelColor,
                            }}
                          >
                            <span className="w-3 h-3 rounded flex items-center justify-center shrink-0" style={{ background: on ? '#a78bfa' : 'transparent', border: `1px solid ${on ? '#a78bfa' : borderColor}` }}>
                              {on && <Check size={9} weight="bold" color="#fff" />}
                            </span>
                            <span className="truncate">{key}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${borderColor}` }}>
              <span className="text-[10px]" style={{ color: labelColor }}>
                {modal.selected.size} {lang === 'vi' ? 'quyền' : 'selected'}
              </span>
              <div className="flex-1" />
              <button onClick={() => setModal(null)} className={btn} style={{ background: borderColor, color: labelColor }}>
                {lang === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={submitModal} disabled={busy} className={btn} style={{ background: '#8b5cf6', color: '#fff', opacity: busy ? 0.6 : 1 }}>
                {modal.mode === 'add' ? (lang === 'vi' ? 'Thêm' : 'Add') : (lang === 'vi' ? 'Lưu' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
