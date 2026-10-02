
function relData(rel) {
  if (!rel) return []
  const inner = rel.data !== undefined ? rel.data : rel
  if (Array.isArray(inner)) return inner.map((x) => x?.attributes || x)
  if (inner && typeof inner === 'object') return [inner.attributes || inner]
  return []
}

function relItem(rel) {
  const rows = relData(rel)
  return rows[0] || null
}

export function inferGame(str = '') {
  const hay = String(str).toLowerCase()
  if (/\bterraria\b|tshock|tmodloader/.test(hay)) return 'terraria'
  return 'minecraft'
}

export function normalizeServer(row) {
  const a = row.attributes || row
  const rel = row.relationships || a.relationships || {}

  const allocations = relData(rel.allocations)
  const primary = allocations.find((x) => x?.is_default) || allocations[0] || null
  const egg = relItem(rel.egg) || null

  const limits = a.limits || {}
  const features = a.feature_limits || {}
  const memoryLimit = Number(limits.memory) || 0
  const diskLimit = Number(limits.disk) || 0
  const cpuLimit = Number(limits.cpu) || 0

  const gameSource = [egg?.name, a.docker_image, a.name, a.description].filter(Boolean).join(' ')
  const game = inferGame(gameSource)

  const identity = a.identifier || a.uuid?.slice(0, 8) || a.internal_id

  return {
    id: identity,
    uuid: a.uuid || '',
    identifier: a.identifier || '',
    internalId: a.internal_id ?? null,
    name: a.name || 'Server',
    description: a.description || '',
    status: a.status || null,
    isInstalling: !!(a.is_installing || a.status === 'installing'),
    isSuspended: !!(a.is_suspended || a.status === 'suspended'),
    isTransferring: !!a.is_transferring,

    game,
    egg: egg?.name || (typeof a.docker_image === 'string' ? a.docker_image.split(':').pop() : '') || '',
    version: a.version || '',
    image: a.docker_image || '',
    node: a.node || '',
    invocation: a.invocation || '',
    eggFeatures: a.egg_features || [],

    port: primary?.port ?? null,
    ip: primary?.ip ?? null,
    ipAlias: primary?.ip_alias ?? '',
    allocations,

    resources: {
      memory: memoryLimit, 
      disk: diskLimit, 
      cpuPercent: cpuLimit, 
      swap: Number(limits.swap) || 0,
      io: Number(limits.io) || 0,
      threads: limits.threads ?? null,
    },
    unlimited: {
      memory: memoryLimit <= 0,
      disk: diskLimit <= 0,
      cpu: cpuLimit <= 0,
    },
    featureLimits: {
      databases: Number(features.databases) || 0,
      allocations: Number(features.allocations) || 0,
      backups: Number(features.backups) || 0,
    },

    sftp: a.sftp_details || null,
    owner: a.server_owner !== false,
    createdAt: a.created_at || null,
    raw: a,
    resourcesUsage: null,
    powerState: null,
  }
}

export function mapState(currentState, server) {
  if (server?.isInstalling) return 'installing'
  if (server?.status === 'installing') return 'installing'
  switch (currentState) {
    case 'running':
      return 'running'
    case 'starting':
      return 'starting'
    case 'stopping':
      return 'stopping'
    case 'offline':
    case 'stopped':
    case null:
    case undefined:
      return server?.isSuspended ? 'stopped' : 'stopped'
    default:
      return 'stopped'
  }
}

const ACTIVITY_ACTIONS = [
  [/server:kill|server\.kill/i, 'kill'],
  [/server:reinstall|server\.reinstall/i, 'install'],
  [/server:restore/i, 'install'],
  [/server:start|server\.start/i, 'start'],
  [/server:stop|server\.stop/i, 'stop'],
  [/server:restart|server\.restart/i, 'restart'],
  [/install/i, 'install'],
]

export function mapActivity(rows) {
  const out = []
  for (const row of rows || []) {
    const event = String(row.event || row.properties?.event || '')
    let action = null
    for (const [re, key] of ACTIVITY_ACTIONS) {
      if (re.test(event)) {
        action = key
        break
      }
    }
    if (!action) continue
    const ts = row.timestamp || row.properties?.timestamp || row.created_at
    const at = ts ? new Date(ts).getTime() : NaN
    if (!Number.isFinite(at)) continue
    out.push({ at, action, event })
  }
  return out.sort((x, y) => y.at - x.at)
}

export function mapResources(payload) {
  const r = payload?.resources || {}
  return {
    state: payload?.current_state || 'offline',
    memory_bytes: Number(r.memory_bytes) || 0,
    cpu_absolute: Number(r.cpu_absolute) || 0,
    disk_bytes: Number(r.disk_bytes) || 0,
    network_rx_bytes: Number(r.network_rx_bytes) || 0,
    network_tx_bytes: Number(r.network_tx_bytes) || 0,
    uptime: Number(r.uptime) || 0,
  }
}

export function cpuScale(threads) {
  const n = Number(threads)
  return Number.isFinite(n) && n > 0 ? 1 / n : 1
}
