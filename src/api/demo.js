
import * as nbt from '../lib/nbt.js'

const ok = (json) => ({ status: 200, ok: true, json })

const SERVER = (id, name, egg, status, mem, cpu, disk) => ({
  attributes: {
    identifier: id,
    uuid: `${id}-0000-0000-0000-000000000000`,
    name,
    description: 'Máy chủ demo của CoPanel',
    status,
    is_suspended: false,
    is_installing: false,
    limits: { memory: 4096, disk: 20480, cpu: 200, swap: 0, io: 500, threads: null },
    feature_limits: { databases: 5, allocations: 5, backups: 5 },
    docker_image: 'ghcr.io/pterodactyl/yolks:java_21',
    node: 'demo-node',
    invocation: 'java -Xms128M -Xmx4096M -jar server.jar',
    created_at: '2026-01-05T09:12:00.000Z',
    server_owner: true,
    sftp_details: { ip: '127.0.0.1', port: 2022 },
    relationships: {
      egg: { attributes: { name: egg } },
      allocations: {
        data: [{ attributes: { ip: '0.0.0.0', port: 25565 + id.charCodeAt(0) % 100, ip_alias: `${id}.demo.copanel`, is_default: true } }],
      },
    },
    demoUsage: { mem, cpu, disk },
  },
  relationships: {},
})

const SERVERS = [
  SERVER('d3m0a1', 'Survival SMP', 'Paper 1.21', 'running', 0.34, 34.2, 0.24),
  SERVER('d3m0b2', 'SkyBlock', 'Paper 1.21', 'stopped', 0, 0, 0.02),
  SERVER('d3m0c3', 'Modded Forge', 'Forge 1.20', 'starting', 0.18, 41.8, 0.4),
]

const PLAYERS = [
  { name: 'Steve', uuid: '11111111-2222-3333-4444-555555555555', last: '2026-09-30T20:10:00Z', op: true },
  { name: 'Alex', uuid: '22222222-3333-4444-5555-666666666666', last: '2026-09-29T18:02:00Z', op: false },
  { name: 'Notch', uuid: '33333333-4444-5555-6666-777777777777', last: '2026-09-27T11:40:00Z', op: false },
]

const HEROBRINE = { name: 'Herobrine', uuid: '44444444-5555-6666-7777-888888888888' }

const FILES = {
  '/': ['server.properties', 'server.jar', 'world', 'plugins', 'logs'],
  '/plugins': ['EssentialsX.jar', 'Vault.jar'],
  '/logs': ['latest.log'],
  '/world': ['level.dat', 'playerdata', 'region'],
  '/world/playerdata': PLAYERS.map((p) => `${p.uuid}.dat`),
  '/world/stats': PLAYERS.map((p) => `${p.uuid}.json`),
  '/world/advancements': [`${PLAYERS[0].uuid}.json`],
}

const PROPS = 'demo:\n  mode: true\nlevel-name: world\nmax-players: 20\n'

const PLAYER_JSON = {
  'usercache.json': [
    ...PLAYERS.map((p) => ({ name: p.name, uuid: p.uuid, expiresOn: p.last })),
    { name: HEROBRINE.name, uuid: HEROBRINE.uuid, expiresOn: '2026-09-20T10:00:00Z' },
  ],
  'ops.json': [{ uuid: PLAYERS[0].uuid, name: PLAYERS[0].name, level: 4, bypassesPlayerLimit: true }],
  'whitelist.json': [{ uuid: PLAYERS[1].uuid, name: PLAYERS[1].name }],
  'banned-players.json': [
    { uuid: HEROBRINE.uuid, name: HEROBRINE.name, created: '2026-09-21T09:12:00Z', source: 'Console', expires: 'forever', reason: 'X-ray / gian lận' },
  ],
}

const CONSOLE_LINES = [
  '[10:00:01 INFO]: Starting minecraft server version 1.21',
  '[10:00:02 INFO]: Loading properties',
  '[10:00:03 INFO]: Default game type: SURVIVAL',
  '[10:00:05 INFO]: Preparing level "world"',
  '[10:00:07 INFO]: Preparing spawn area: 62%',
  '[10:00:09 INFO]: Done (7.812s)! For help, type "help"',
  '[10:00:12 INFO]: Steve joined the game',
  '[10:00:20 INFO]: [EssentialsX] Enabling EssentialsX v2.20.1',
  '[10:00:31 INFO]: Alex joined the game',
  '[10:01:02 INFO]: [spark] Starting background profiler...',
  '[10:01:20 INFO]: Saving chunks for level \'ServerLevel[world]\'/minecraft:overworld',
]

let tick = 0
export const demoConsoleLines = () => {
  const line = CONSOLE_LINES[tick % CONSOLE_LINES.length]
  tick += 1
  return line
}

const fileRow = (name, dir) => ({
  name,
  size: dir ? 0 : 1024 + ((name.length * 733) % 900000),
  is_file: !dir,
  is_symlink: false,
  mimetype: dir ? 'inode/directory' : 'application/octet-stream',
  mode: dir ? 'drwxr-xr-x' : '-rw-r--r--',
  mode_bits: '755',
  created_at: '2026-01-05T09:12:00.000Z',
  modified_at: '2026-09-30T21:40:00.000Z',
})


export function demoRequest(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== null && v !== '') query.set(k, String(v))
  const p = String(path)
  const parts = p.split('/').filter(Boolean)
  const id = parts[3]

  if (p.endsWith('/api/client/account') && method === 'GET') {
    return ok({ attributes: { id: 1, uuid: 'demo-account-uuid', username: 'demo', email: 'demo@copanel.local', root_admin: true, image: '' } })
  }
  if (p.endsWith('/api/client')) {
    return ok({ object: 'list', data: SERVERS })
  }
  if (p.endsWith('/api/client/permissions')) {
    return ok({ attributes: { permissions: { websocket: { connect: 'Connect to the console', send: 'Send commands' }, control: { start: 'Start', stop: 'Stop', restart: 'Restart', console: 'Console' } } } })
  }
  if (p.includes('/api/client/servers/') && p.endsWith('/resources')) {
    const srv = SERVERS.find((s) => s.attributes.identifier === id) || SERVERS[0]
    const u = srv.attributes.demoUsage
    const wobble = 1 + Math.sin(Date.now() / 4000) * 0.06
    return ok({
      attributes: {
        current_state: srv.attributes.status,
        is_suspended: false,
        resources: {
          memory_bytes: Math.round(4096 * 1024 * 1024 * u.mem * wobble),
          memory_limit_bytes: 4096 * 1024 * 1024,
          cpu_absolute: Math.round(u.cpu * wobble * 10) / 10,
          disk_bytes: Math.round(20480 * 1024 * 1024 * u.disk),
          network_rx_bytes: 3_214_512, network_tx_bytes: 8_112_004,
          uptime: 5_412_000,
        },
      },
    })
  }
  if (p.includes('/api/client/servers/') && p.endsWith('/activity')) {
    const now = Date.now()
    return ok({
      object: 'list',
      data: [
        { id: 'a1', attributes: { event: 'server:start', timestamp: new Date(now - 5_400_000).toISOString() } },
        { id: 'a2', attributes: { event: 'server:stop', timestamp: new Date(now - 86_400_000).toISOString() } },
        { id: 'a3', attributes: { event: 'server:start', timestamp: new Date(now - 172_800_000).toISOString() } },
      ],
    })
  }
  if (p.includes('/api/client/servers/') && p.endsWith('/websocket')) {
    return ok({ data: { token: 'demo-token', socket: '' } })
  }
  if (p.includes('/api/client/servers/') && p.endsWith('/power')) return ok({})
  if (p.includes('/api/client/servers/') && p.endsWith('/command')) return ok({})

  if (p.endsWith('/files/list')) {
    const dir = query.get('directory') || '/'
    const names = FILES[dir] || []
    return ok({
      object: 'list',
      data: names.map((n) => ({ object: 'file_object', attributes: fileRow(n, !n.includes('.')) })),
    })
  }
  if (p.endsWith('/files/contents')) {
    const file = query.get('file') || ''
    if (file.endsWith('server.properties')) return { status: 200, ok: true, json: PROPS }
    const row = PLAYER_JSON[file.split('/').pop()]
    return { status: 200, ok: true, json: row ? JSON.stringify(row) : '{}' }
  }
  if (p.includes('/files/download')) return ok({ attributes: { url: '' } })
  if (p.includes('/files/upload')) return ok({ attributes: { url: '' } })

  if (p.endsWith('/databases')) {
    return ok({
      object: 'list',
      data: [
        { attributes: { id: 1, name: 'srv_survival', username: 'u_survival', host: { address: 'db.demo.copanel', port: 3306 }, connections_from: '%', max_connections: 0 } },
      ],
    })
  }
  if (p.endsWith('/schedules')) {
    return ok({
      object: 'list',
      data: [
        { attributes: { id: 1, name: 'Backup hằng đêm', cron: { minute: '0', hour: '3', day_of_month: '*', month: '*', day_of_week: '*' }, is_active: true, last_run_at: new Date(Date.now() - 43_200_000).toISOString(), next_run_at: new Date(Date.now() + 43_200_000).toISOString(), relationships: { tasks: { data: [{ attributes: { id: 1, action: 'backup', payload: '', time_offset: 0 } }] } } } },
      ],
    })
  }
  if (p.endsWith('/backups')) {
    return ok({
      object: 'list',
      data: [
        { attributes: { uuid: 'b1', name: 'backup-2026-09-30.tar.gz', bytes: 412_000_000, is_successful: true, is_locked: false, checksum: 'demo', created_at: new Date(Date.now() - 43_200_000).toISOString() } },
      ],
      meta: { backup_count: 1 },
    })
  }
  if (p.endsWith('/allocations')) {
    return ok({
      object: 'list',
      data: [
        { attributes: { id: 1, ip: '0.0.0.0', port: 25565, ip_alias: 'survival.demo.copanel', is_default: true, notes: 'Cổng chính' } },
        { attributes: { id: 2, ip: '0.0.0.0', port: 25566, ip_alias: '', is_default: false, notes: '' } },
      ],
    })
  }
  if (p.endsWith('/startup')) {
    return ok({
      object: 'list',
      data: [
        { attributes: { name: 'Minecraft Version', description: 'Phiên bản Minecraft (mặc định mới nhất).', env_variable: 'MINECRAFT_VERSION', default_value: 'latest', server_value: 'latest', is_editable: true, rules: 'required|string|max:20' } },
        { attributes: { name: 'Server Jar File', description: 'Tên tệp jar chạy server.', env_variable: 'SERVER_JARFILE', default_value: 'server.jar', server_value: 'server.jar', is_editable: true, rules: 'required|string' } },
      ],
      meta: { startup_command: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}' },
    })
  }
  if (p.endsWith('/users')) {
    return ok({
      object: 'list',
      data: [{ attributes: { uuid: 'demo-sub', username: 'builder', email: 'builder@copanel.local', permissions: ['control.start', 'control.console'], created_at: '2026-03-01T00:00:00Z' } }],
    })
  }

  if (p.includes('/api/client/servers/') && parts.length === 4) {
    const srv = SERVERS.find((s) => s.attributes.identifier === id)
    return ok(srv || SERVERS[0])
  }
  return ok({ object: 'list', data: [] })
}


export const demoPing = () => ({
  ok: true,
  online: PLAYERS.length,
  max: 20,
  sample: PLAYERS.map((p) => ({ name: p.name, id: p.uuid })),
  version: '1.21',
  motd: 'CoPanel demo',
  latencyMs: 21,
  host: 'demo.copanel',
  port: 25565,
  via: 'demo',
  at: Date.now(),
})


export const demoPlayers = () => PLAYERS.map((p) => ({ ...p }))

const invStore = new Map()
const invItem = (slot, id, count) =>
  nbt.nbtCompoundOf({ Slot: nbt.nbtInt(slot), Count: nbt.nbtByte(count), id: nbt.nbtStr(id) })

export function demoInventoryModel(uuid) {
  const key = String(uuid || 'demo')
  const cached = invStore.get(key)
  if (cached) return cached
  const model = {
    name: '',
    root: nbt.nbtCompoundOf({
      DataVersion: nbt.nbtInt(3953),
      Inventory: nbt.nbtListOf(
        [
          invItem(0, 'minecraft:diamond_sword', 1),
          invItem(1, 'minecraft:golden_apple', 12),
          invItem(2, 'minecraft:diamond', 37),
          invItem(3, 'minecraft:torch', 64),
          invItem(4, 'minecraft:ender_pearl', 8),
          invItem(9, 'minecraft:iron_ingot', 51),
          invItem(10, 'minecraft:emerald', 19),
          invItem(11, 'minecraft:golden_carrot', 32),
          invItem(18, 'minecraft:oak_log', 64),
          invItem(19, 'minecraft:cobblestone', 64),
          invItem(20, 'minecraft:crafting_table', 1),
          invItem(27, 'minecraft:water_bucket', 1),
          invItem(28, 'minecraft:cooked_beef', 16),
          invItem(103, 'minecraft:diamond_helmet', 1),
          invItem(102, 'minecraft:diamond_chestplate', 1),
          invItem(101, 'minecraft:diamond_leggings', 1),
          invItem(100, 'minecraft:diamond_boots', 1),
          invItem(-106, 'minecraft:shield', 1),
        ],
        nbt.TAG.Compound,
      ),
      EnderItems: nbt.nbtListOf([invItem(0, 'minecraft:shulker_box', 2)], nbt.TAG.Compound),
    }),
  }
  invStore.set(key, model)
  return model
}

export const demoStoreInventory = (uuid, model) => { invStore.set(String(uuid || 'demo'), model) }
