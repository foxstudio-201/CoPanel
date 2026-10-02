
export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
}

function readNumeric(view, type, offset) {
  switch (type) {
    case TAG.Byte:
      return { value: view.getInt8(offset), size: 1 }
    case TAG.Short:
      return { value: view.getInt16(offset), size: 2 }
    case TAG.Int:
      return { value: view.getInt32(offset), size: 4 }
    case TAG.Long:
      return { value: view.getBigInt64(offset), size: 8 }
    case TAG.Float:
      return { value: view.getFloat32(offset), size: 4 }
    case TAG.Double:
      return { value: view.getFloat64(offset), size: 8 }
    default:
      throw new Error(`unsupported numeric tag ${type}`)
  }
}

export function parseNbt(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder('utf-8')
  let pos = 0

  const readString = () => {
    const len = view.getUint16(pos)
    pos += 2
    const raw = buf.subarray(pos, pos + len)
    pos += len
    return { text: dec.decode(raw), raw }
  }

  const readPayload = (type) => {
    switch (type) {
      case TAG.Byte:
      case TAG.Short:
      case TAG.Int:
      case TAG.Long:
      case TAG.Float:
      case TAG.Double: {
        const { value, size } = readNumeric(view, type, pos)
        pos += size
        return { type, value }
      }
      case TAG.ByteArray: {
        const len = view.getInt32(pos)
        pos += 4
        const raw = buf.subarray(pos, pos + len)
        pos += len
        return { type, value: len, raw }
      }
      case TAG.String: {
        const s = readString()
        return { type, value: s.text, raw: s.raw }
      }
      case TAG.IntArray: {
        const len = view.getInt32(pos)
        pos += 4
        const value = []
        for (let i = 0; i < len; i++) {
          value.push(view.getInt32(pos))
          pos += 4
        }
        return { type, value }
      }
      case TAG.LongArray: {
        const len = view.getInt32(pos)
        pos += 4
        const value = []
        for (let i = 0; i < len; i++) {
          value.push(view.getBigInt64(pos))
          pos += 8
        }
        return { type, value }
      }
      case TAG.List: {
        const itemType = view.getUint8(pos)
        pos += 1
        const len = view.getInt32(pos)
        pos += 4
        const items = []
        for (let i = 0; i < len; i++) items.push(readPayload(itemType))
        return { type, itemType, items }
      }
      case TAG.Compound: {
        const entries = new Map()
        for (;;) {
          const t = view.getUint8(pos)
          pos += 1
          if (t === TAG.End) break
          const key = readString()
          entries.set(key.text, { name: key.text, nameRaw: key.raw, ...readPayload(t) })
        }
        return { type, entries }
      }
      default:
        throw new Error(`unsupported tag type ${type}`)
    }
  }

  const rootType = view.getUint8(pos)
  pos += 1
  const rootName = readString()
  const root = readPayload(rootType)
  return { name: rootName.text, root }
}

export function serializeNbt({ name, root }) {
  const enc = new TextEncoder()
  const chunks = []
  let length = 0
  const push = (bytes) => {
    chunks.push(bytes)
    length += bytes.length
  }
  const writeString = (text, raw) => {
    const body = raw ?? enc.encode(String(text ?? ''))
    const head = new Uint8Array(2)
    new DataView(head.buffer).setUint16(0, body.length)
    push(head)
    push(body)
  }
  const writeNumeric = (type, value) => {
    const size = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 }[type]
    const b = new Uint8Array(size)
    const dv = new DataView(b.buffer)
    if (type === TAG.Byte) dv.setInt8(0, value)
    else if (type === TAG.Short) dv.setInt16(0, value)
    else if (type === TAG.Int) dv.setInt32(0, value)
    else if (type === TAG.Long) dv.setBigInt64(0, typeof value === 'bigint' ? value : BigInt(value))
    else if (type === TAG.Float) dv.setFloat32(0, value)
    else dv.setFloat64(0, value)
    push(b)
  }
  const writePayload = (node) => {
    switch (node.type) {
      case TAG.Byte:
      case TAG.Short:
      case TAG.Int:
      case TAG.Long:
      case TAG.Float:
      case TAG.Double:
        writeNumeric(node.type, node.value)
        break
      case TAG.ByteArray: {
        const raw = node.raw ?? new Uint8Array(node.value || 0)
        const head = new Uint8Array(4)
        new DataView(head.buffer).setInt32(0, raw.length)
        push(head)
        push(raw)
        break
      }
      case TAG.String:
        writeString(node.value, node.raw)
        break
      case TAG.IntArray: {
        const head = new Uint8Array(4)
        new DataView(head.buffer).setInt32(0, node.value.length)
        push(head)
        for (const v of node.value) writeNumeric(TAG.Int, v)
        break
      }
      case TAG.LongArray: {
        const head = new Uint8Array(4)
        new DataView(head.buffer).setInt32(0, node.value.length)
        push(head)
        for (const v of node.value) writeNumeric(TAG.Long, v)
        break
      }
      case TAG.List: {
        const itemType = node.itemType ?? (node.items[0]?.type ?? TAG.End)
        push(new Uint8Array([itemType]))
        const head = new Uint8Array(4)
        new DataView(head.buffer).setInt32(0, node.items.length)
        push(head)
        for (const item of node.items) writePayload(item)
        break
      }
      case TAG.Compound: {
        for (const entry of node.entries.values()) {
          push(new Uint8Array([entry.type]))
          writeString(entry.name, entry.nameRaw)
          writePayload(entry)
        }
        push(new Uint8Array([TAG.End]))
        break
      }
      default:
        throw new Error(`unsupported tag type ${node.type}`)
    }
  }

  push(new Uint8Array([root.type]))
  writeString(name)
  writePayload(root)

  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const nbtNumber = (node) => (node && typeof node.value !== 'undefined' ? Number(node.value) : undefined)
export const nbtString = (node) => (node && node.type === TAG.String ? node.value : undefined)
export const nbtCompound = (node) => (node && node.type === TAG.Compound ? node.entries : null)
export const nbtList = (node) => (node && node.type === TAG.List ? node.items : null)

export const nbtInt = (value) => ({ type: TAG.Int, value: Math.trunc(value) })
export const nbtShort = (value) => ({ type: TAG.Short, value: Math.trunc(value) })
export const nbtByte = (value) => ({ type: TAG.Byte, value: Math.trunc(value) })
export const nbtStr = (value) => ({ type: TAG.String, value: String(value) })
export const nbtCompoundOf = (entries) => ({
  type: TAG.Compound,
  entries: new Map(Object.entries(entries).map(([k, v]) => [k, { name: k, ...v }])),
})
export const nbtListOf = (items, itemType) => ({ type: TAG.List, itemType, items })
