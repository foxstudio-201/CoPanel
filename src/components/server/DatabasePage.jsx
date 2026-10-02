import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash, Copy } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import * as api from '../../api/client.js'

export default function DatabasePage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [databases, setDatabases] = useState(server?.databases || [])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newDb, setNewDb] = useState({ name: '', user: '', pass: '' })
  const [copied, setCopied] = useState(null)
  const [hosts, setHosts] = useState([])
  const [hostUuid, setHostUuid] = useState('')

  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500) }

  useEffect(() => {
    if (!api.isCalagopus()) return undefined
    let alive = true
    api.listDatabaseHosts(server.id)
      .then((rows) => {
        if (!alive) return
        setHosts(rows)
        setHostUuid((prev) => prev || rows[0]?.uuid || '')
      })
      .catch(() => {})
    return () => { alive = false }
  }, [server.id])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDatabases(await api.listDatabases(server.id))
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Không tải được danh sách database' : 'Could not load databases'), 'error')
    } finally {
      setLoading(false)
    }
  }, [server.id, lang])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const name = newDb.name.trim()
    if (!name) return
    if (api.isCalagopus() && !hostUuid) {
      showToast(lang === 'vi' ? 'Chọn máy chủ database trước' : 'Pick a database host first', 'error')
      return
    }
    try {
      const db = await api.createDatabase(server.id, {
        database: name,
        remote: '%',
        database_host_uuid: hostUuid,
      })
      setDatabases((prev) => [...prev, db])
      setShowCreate(false)
      setNewDb({ name: '', user: '', pass: '' })
      showToast(
        lang === 'vi'
          ? `Đã tạo ${db.name} — user: ${db.username}`
          : `Created ${db.name} — user: ${db.username}`,
        'success',
        5000,
      )
      if (db.password) {
        setTimeout(() => copy(db.password, 'pwd'), 100)
        showToast(
          lang === 'vi' ? 'Đã sao chép mật khẩu database vào clipboard' : 'Database password copied to clipboard',
          'success',
          4000,
        )
      }
      load()
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Tạo database thất bại' : 'Could not create the database'), 'error')
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Cơ sở dữ liệu' : 'Databases'}</h2>
        <div className="flex-1" />
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#8b5cf6', color: '#fff' }}>
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Tạo mới' : 'Create'}
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input value={newDb.name} onChange={e => setNewDb({...newDb, name: e.target.value})} placeholder="Database name" className="px-3 py-1.5 rounded-lg text-[11px] outline-none" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
            {api.isCalagopus() ? (
              <select
                value={hostUuid}
                onChange={(e) => setHostUuid(e.target.value)}
                className="col-span-2 px-3 py-1.5 rounded-lg text-[11px] outline-none"
                style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }}
              >
                {hosts.length === 0 && <option value="">{lang === 'vi' ? 'Không có máy chủ database' : 'No database host'}</option>}
                {hosts.map((h) => (
                  <option key={h.uuid} value={h.uuid}>{h.name}{h.host ? ` (${h.host}${h.port ? ':' + h.port : ''})` : ''}</option>
                ))}
              </select>
            ) : (
              <div className="col-span-2 flex items-center px-3 py-1.5 rounded-lg text-[10px]" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}`, color: labelColor }}>
                {lang === 'vi' ? 'User và mật khẩu do panel tự sinh (không nhập được).' : 'The panel generates the username and password.'}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1 rounded-lg text-[11px] font-semibold" style={{ background: '#22c55e', color: '#fff' }}>{lang === 'vi' ? 'Tạo' : 'Create'}</button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-1 rounded-lg text-[11px] font-semibold" style={{ background: borderColor, color: labelColor }}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && databases.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Đang tải…' : 'Loading…'}</span>
          </div>
        ) : databases.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Chưa có database' : 'No databases yet'}</span>
          </div>
        ) : databases.map((db, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#8b5cf620' }}>
              <span className="text-[10px] font-bold" style={{ color: '#8b5cf6' }}>DB</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold truncate" style={{ color: textColor }}>{db.name}</p>
              <p className="text-[10px] truncate" style={{ color: labelColor }}>{db.user}@{db.host}:{db.port}</p>
            </div>
            <button onClick={() => copy(`${db.host}:${db.port}/${db.name}`, `db-${i}`)} className="p-1 rounded" style={{ color: copied === `db-${i}` ? '#22c55e' : labelColor }}>
              <Copy size={12} weight="duotone" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
