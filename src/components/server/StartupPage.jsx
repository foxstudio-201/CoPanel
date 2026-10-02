import { useState, useEffect, useCallback } from 'react'
import { showToast } from '../../lib/toast'
import * as api from '../../api/client.js'

export default function StartupPage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const inputBg = theme === 'light' ? '#fff' : '#1a1a1a'

  const [variables, setVariables] = useState([])
  const [meta, setMeta] = useState({})
  const [values, setValues] = useState({})
  const [startup, setStartup] = useState('')
  const [dockerImage, setDockerImage] = useState(server?.image || '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getStartup(server.id)
      const vars = Array.isArray(data?.variables) ? data.variables : []
      setVariables(vars)
      setMeta(data?.meta || {})
      const map = {}
      for (const v of vars) map[v.env_variable] = String(v.server_value ?? v.default_value ?? '')
      setValues(map)
      setStartup(data?.meta?.startup_command || data?.meta?.raw_startup_command || '')
      setDockerImage((prev) => server?.image || prev)
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Không tải được cấu hình khởi động' : 'Could not load startup data'), 'error')
    } finally {
      setLoading(false)
    }
  }, [server.id, server?.image, lang])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const changed = variables.filter((v) => {
        if (v.is_editable === false) return false
        const next = String(values[v.env_variable] ?? '')
        return next !== String(v.server_value ?? v.default_value ?? '')
      })
      for (const v of changed) await api.setStartupVariable(server.id, v.env_variable, values[v.env_variable])

      if (dockerImage && dockerImage !== server?.image) await api.setDockerImage(server.id, dockerImage)

      showToast(lang === 'vi' ? 'Đã lưu cấu hình khởi động' : 'Startup config saved', 'success')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await load()
    } catch (err) {
      showToast(err?.message || (lang === 'vi' ? 'Lưu thất bại' : 'Save failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const images = meta?.docker_images && typeof meta.docker_images === 'object' ? meta.docker_images : null
  const imageOptions = images
    ? [...new Set([server?.image, ...Object.values(images)].filter(Boolean))]
    : []

  return (
    <div className="h-full flex flex-col overflow-y-auto p-4 gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Khởi động' : 'Startup Configuration'}</h2>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 hover:opacity-80 active:scale-95 disabled:opacity-60"
          style={{ background: saved ? '#22c55e' : '#8b5cf6', color: '#fff' }}
        >
          {saved ? (lang === 'vi' ? 'Đã lưu!' : 'Saved!') : (lang === 'vi' ? 'Lưu' : 'Save')}
        </button>
      </div>

      {}
      <div>
        <label className="text-[11px] font-semibold mb-1 block" style={{ color: labelColor }}>{lang === 'vi' ? 'Lệnh khởi động' : 'Startup Command'}</label>
        <input
          value={startup}
          readOnly
          title={lang === 'vi' ? 'Lệnh khởi động do egg định nghĩa, chỉ đọc được qua Client API' : 'The startup command comes from the egg and is read-only in the Client API'}
          className="w-full px-3 py-2 rounded-lg text-[11px] font-mono outline-none cursor-not-allowed"
          style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}`, color: labelColor }}
        />
      </div>

      {}
      <div>
        <label className="text-[11px] font-semibold mb-1 block" style={{ color: labelColor }}>Docker Image</label>
        {imageOptions.length > 0 ? (
          <select
            value={dockerImage}
            onChange={(e) => setDockerImage(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[11px] font-mono outline-none transition-colors focus:border-[#8b5cf6]"
            style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
          >
            {imageOptions.map((img) => (
              <option key={img} value={img}>
                {Object.keys(images).find((k) => images[k] === img) || img}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={dockerImage}
            onChange={(e) => setDockerImage(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[11px] font-mono outline-none transition-colors focus:border-[#8b5cf6]"
            style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
          />
        )}
      </div>

      {}
      <div>
        <label className="text-[11px] font-semibold mb-2 block" style={{ color: labelColor }}>{lang === 'vi' ? 'Biến môi trường' : 'Environment Variables'}</label>
        {loading && variables.length === 0 ? (
          <p className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Đang tải…' : 'Loading…'}</p>
        ) : variables.length === 0 ? (
          <p className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Egg này không có biến nào' : 'This egg exposes no variables'}</p>
        ) : variables.map((v) => {
          const editable = v.is_editable !== false
          const key = v.env_variable
          return (
            <div key={key} className="mb-2">
              <div className="flex gap-2">
                <input
                  value={key}
                  readOnly
                  title={v.description || v.name || key}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-mono outline-none"
                  style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}`, color: labelColor }}
                />
                <input
                  value={values[key] ?? ''}
                  readOnly={!editable}
                  onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  title={editable ? (v.rules || '') : (lang === 'vi' ? 'Biến này chỉ đọc' : 'This variable is read-only')}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-mono outline-none transition-colors focus:border-[#8b5cf6]"
                  style={{
                    background: editable ? inputBg : (theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'),
                    border: `1px solid ${borderColor}`,
                    color: editable ? textColor : labelColor,
                    cursor: editable ? 'text' : 'not-allowed',
                  }}
                />
              </div>
              {(v.name || v.description) && (
                <p className="text-[9px] mt-0.5 ml-1" style={{ color: labelColor }}>{v.name}{v.description ? ` — ${v.description}` : ''}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
