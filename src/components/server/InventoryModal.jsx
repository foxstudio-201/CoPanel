import { useEffect, useMemo, useState } from 'react'
import { X, SpinnerGap, Warning, Plus, Trash, FloppyDisk, ArrowCounterClockwise, Backpack } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import {
  loadInventory, saveInventory, setItem, clearSlot, firstEmptySlot,
  itemLabel, itemTextureUrls, normalizeItemId, SLOTS,
} from '../../api/players.js'

export default function InventoryModal({ serverId, world, player, online, theme, lang, onClose }) {
  const vi = lang === 'vi'
  const isLight = theme === 'light'
  const textColor = isLight ? '#111' : '#fff'
  const labelColor = isLight ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isLight ? '#fff' : '#141414'
  const slotBg = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'

  const [state, setState] = useState('loading') 
  const [error, setError] = useState('')
  const [model, setModel] = useState(null)
  const [items, setItems] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sel, setSel] = useState(null)
  const [add, setAdd] = useState(null) 

  const load = async () => {
    setState('loading')
    setError('')
    try {
      const inv = await loadInventory(serverId, world, player)
      setModel(inv.model)
      setItems(inv.items)
      setDirty(false)
      setState('ready')
    } catch (err) {
      setError(err?.message || 'load-failed')
      setState('error')
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!alive) return
      await load()
    })()
    return () => {
      alive = false
    }
  }, [serverId, world, player?.uuid])

  const bySlot = useMemo(() => {
    const map = new Map()
    for (const it of items) map.set(it.slot, it)
    return map
  }, [items])

  const refresh = (next) => {
    const map = new Map()
    for (const it of next) map.set(it.slot, it)
    setItems(next)
    setDirty(true)
    setSel(null)
  }

  const removeSlot = (slot) => {
    clearSlot(model, slot)
    refresh(items.filter((it) => it.slot !== slot))
  }

  const addItem = () => {
    const id = normalizeItemId(add.id)
    if (!id) {
      showToast(vi ? 'Item id không hợp lệ (ví dụ: diamond hoặc minecraft:diamond)' : 'Invalid item id', 'error')
      return
    }
    const slot = add.slot === '' ? firstEmptySlot(model) : Number(add.slot)
    if (slot == null || Number.isNaN(slot)) {
      showToast(vi ? 'Kho đồ đã đầy, chọn ô để ghi đè' : 'Inventory is full - pick a slot', 'error')
      return
    }
    const count = Math.max(1, Math.min(127, Math.trunc(Number(add.count) || 1)))
    setItem(model, { slot, id, count })
    refresh([...items.filter((it) => it.slot !== slot), { slot, id, count }])
    setAdd(null)
    showToast(vi ? `Đã thêm ${itemLabel(id)} x${count} vào ô ${slot}` : `Added ${itemLabel(id)} x${count} to slot ${slot}`, 'success')
  }

  const save = async () => {
    if (online) {
      showToast(vi ? 'Player đang online - phải để player thoát trước khi lưu' : 'Player is online - they must disconnect first', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await saveInventory(serverId, world, player, model)
      setDirty(false)
      showToast(
        vi
          ? `Đã lưu kho đồ (bản sao lưu: ${res.backup.split('/').pop()})`
          : `Inventory saved (backup: ${res.backup.split('/').pop()})`,
        'success',
        6000,
      )
    } catch (err) {
      showToast(err?.message || (vi ? 'Lưu thất bại' : 'Save failed'), 'error', 6000)
    } finally {
      setSaving(false)
    }
  }

  const Tile = ({ slot }) => {
    const it = bySlot.get(slot)
    const [tryIdx, setTryIdx] = useState(0)
    const urls = it ? itemTextureUrls(it.id) : []
    const active = sel === slot
    return (
      <button
        type="button"
        onClick={() => it && setSel(active ? null : slot)}
        title={it ? `${itemLabel(it.id)} x${it.count} (${it.id})` : `${vi ? 'Ô trống' : 'Empty'} ${slot}`}
        className="relative aspect-square rounded-lg flex items-center justify-center cursor-pointer transition-all"
        style={{
          background: slotBg,
          border: `1px solid ${active ? '#a78bfa' : borderColor}`,
          boxShadow: active ? '0 0 0 1px #a78bfa55' : 'none',
        }}
      >
        {it && tryIdx < urls.length ? (
          <img
            src={urls[tryIdx]}
            alt=""
            className="w-[70%] h-[70%] object-contain"
            style={{ imageRendering: 'pixelated' }}
            onError={() => setTryIdx((i) => i + 1)}
          />
        ) : it ? (
          <span className="text-[10px] font-bold" style={{ color: '#a78bfa' }}>
            {itemLabel(it.id).slice(0, 2)}
          </span>
        ) : null}
        {it && it.count > 1 ? (
          <span className="absolute bottom-0.5 right-1 text-[10px] font-bold" style={{ color: textColor, textShadow: '0 0 2px rgba(0,0,0,0.6)' }}>
            {it.count}
          </span>
        ) : null}
      </button>
    )
  }

  const Grid = ({ slots, perRow }) => (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
      {slots.map((s) => (
        <Tile key={s} slot={s} />
      ))}
    </div>
  )

  const selItem = sel != null ? bySlot.get(sel) : null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="w-[620px] max-h-[88vh] overflow-y-auto rounded-2xl p-4"
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#a78bfa20', border: '1px solid #a78bfa40' }}>
            <Backpack size={17} weight="duotone" style={{ color: '#a78bfa' }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate" style={{ color: textColor }}>
              {vi ? 'Kho đồ' : 'Inventory'} · {player?.name || player?.uuid}
            </p>
            <p className="text-[10px] truncate" style={{ color: labelColor }}>
              {world}/playerdata/{player?.dataFile}
            </p>
          </div>
          {dirty ? (
            <span className="text-[10px] px-2 py-1 rounded-md shrink-0" style={{ background: '#eab30820', color: '#eab308' }}>
              {vi ? 'Chưa lưu' : 'Unsaved'}
            </span>
          ) : null}
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer" style={{ background: slotBg, color: labelColor }}>
            <X size={13} weight="bold" />
          </button>
        </div>

        {online ? (
          <div className="flex items-start gap-2 p-2.5 rounded-lg mb-3 text-[11px]" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#ef4444' }}>
            <Warning size={13} weight="duotone" className="mt-0.5 shrink-0" />
            <span>
              {vi
                ? 'Player đang online: server đang giữ kho đồ trong RAM nên file chưa cập nhật. Hãy để player thoát (hoặc dừng server) trước khi lưu — nếu không thay đổi sẽ bị ghi đè.'
                : 'Player is online: the server holds the inventory in memory, the file is stale. Disconnect the player (or stop the server) before saving.'}
            </span>
          </div>
        ) : null}

        {state === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-16" style={{ color: labelColor }}>
            <SpinnerGap size={18} className="animate-spin" />
            <span className="text-xs">{vi ? 'Đang đọc file player…' : 'Reading player file…'}</span>
          </div>
        ) : state === 'error' ? (
          <div className="flex flex-col items-center gap-2 py-14">
            <Warning size={26} weight="light" style={{ color: '#ef4444' }} />
            <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>
            <button onClick={load} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer" style={{ background: '#a78bfa20', color: '#a78bfa' }}>
              {vi ? 'Thử lại' : 'Retry'}
            </button>
          </div>
        ) : (
          <>
            <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wide" style={{ color: labelColor }}>
              {vi ? 'Túi đồ (36 ô)' : 'Main inventory (36)'}
            </p>
            <Grid slots={SLOTS.main} perRow={9} />

            <div className="flex items-start gap-5 mt-4">
              <div>
                <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wide" style={{ color: labelColor }}>
                  {vi ? 'Giáp' : 'Armour'}
                </p>
                <div style={{ width: 190 }}>
                  <Grid slots={SLOTS.armor} perRow={2} />
                </div>
              </div>
              <div>
                <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wide" style={{ color: labelColor }}>
                  {vi ? 'Tay trái' : 'Offhand'}
                </p>
                <div style={{ width: 92 }}>
                  <Grid slots={[SLOTS.offhand]} perRow={1} />
                </div>
              </div>
            </div>

            {}
            {selItem ? (
              <div className="flex items-center gap-2 mt-4 p-2.5 rounded-xl" style={{ background: slotBg, border: `1px solid ${borderColor}` }}>
                <img
                  src={itemTextureUrls(selItem.id)[0]}
                  alt=""
                  className="w-8 h-8 object-contain shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate" style={{ color: textColor }}>
                    {itemLabel(selItem.id)} x{selItem.count}
                  </p>
                  <p className="text-[10px] font-mono truncate" style={{ color: labelColor }}>
                    {selItem.id} · {vi ? 'ô' : 'slot'} {selItem.slot}
                  </p>
                </div>
                <button
                  onClick={() => removeSlot(selItem.slot)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
                  style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }}
                >
                  <Trash size={12} weight="duotone" /> {vi ? 'Xoá món này' : 'Remove'}
                </button>
              </div>
            ) : null}

            {}
            {add ? (
              <div className="flex flex-wrap items-end gap-2 mt-4 p-2.5 rounded-xl" style={{ background: slotBg, border: `1px solid ${borderColor}` }}>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium" style={{ color: labelColor }}>{vi ? 'Item id' : 'Item id'}</span>
                  <input
                    autoFocus
                    value={add.id}
                    onChange={(e) => setAdd({ ...add, id: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addItem()}
                    placeholder="diamond / minecraft:golden_apple"
                    className="w-56 px-2.5 py-1.5 rounded-lg text-[11px] font-mono outline-none"
                    style={{ background: isLight ? '#fff' : '#0f0f0f', color: textColor, border: `1px solid ${borderColor}` }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium" style={{ color: labelColor }}>{vi ? 'Số lượng' : 'Count'}</span>
                  <input
                    type="number" min="1" max="127"
                    value={add.count}
                    onChange={(e) => setAdd({ ...add, count: e.target.value })}
                    className="w-20 px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
                    style={{ background: isLight ? '#fff' : '#0f0f0f', color: textColor, border: `1px solid ${borderColor}` }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium" style={{ color: labelColor }}>{vi ? 'Ô (trống = tự chọn)' : 'Slot (blank = auto)'}</span>
                  <input
                    type="number"
                    value={add.slot}
                    onChange={(e) => setAdd({ ...add, slot: e.target.value })}
                    placeholder={vi ? 'tự chọn' : 'auto'}
                    className="w-24 px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
                    style={{ background: isLight ? '#fff' : '#0f0f0f', color: textColor, border: `1px solid ${borderColor}` }}
                  />
                </label>
                <button onClick={addItem} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer" style={{ background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}>
                  <Plus size={12} weight="bold" /> {vi ? 'Thêm' : 'Add'}
                </button>
                <button onClick={() => setAdd(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer" style={{ background: borderColor, color: labelColor }}>
                  {vi ? 'Huỷ' : 'Cancel'}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <button
                  onClick={() => setAdd({ id: '', count: 1, slot: '' })}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold cursor-pointer"
                  style={{ background: '#a78bfa20', color: '#a78bfa', border: '1px solid #a78bfa40' }}
                >
                  <Plus size={13} weight="bold" /> {vi ? 'Thêm đồ' : 'Give item'}
                </button>
                <span className="text-[10px]" style={{ color: labelColor }}>
                  {vi ? 'Ghi trực tiếp vào file player · tự tạo bản sao lưu trước khi lưu' : 'Writes the player file directly · a backup is made on save'}
                </span>
              </div>
            )}

            {}
            <div className="flex items-center gap-2 mt-4 pt-3" style={{ borderTop: `1px solid ${borderColor}` }}>
              <button
                onClick={save}
                disabled={saving || !dirty || online}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#a78bfa', color: '#0a0a0a' }}
              >
                {saving ? <SpinnerGap size={13} className="animate-spin" /> : <FloppyDisk size={13} weight="duotone" />}
                {saving ? (vi ? 'Đang lưu…' : 'Saving…') : vi ? 'Lưu vào file player' : 'Save to player file'}
              </button>
              <button
                onClick={load}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                style={{ background: borderColor, color: labelColor }}
              >
                <ArrowCounterClockwise size={13} weight="duotone" /> {vi ? 'Đọc lại' : 'Reload'}
              </button>
              {dirty ? (
                <span className="text-[10px]" style={{ color: '#eab308' }}>
                  {vi ? 'Có thay đổi chưa ghi vào file' : 'Unsaved changes'}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
