
export function account(json) {
  return json?.user || null
}

export function serverRow(row) {
  const alloc = row?.allocation || null
  const limits = row?.limits || {}
  const features = row?.feature_limits || {}
  return {
    attributes: {
      identifier: row?.uuid_short || row?.uuid || '',
      uuid: row?.uuid || '',
      name: row?.name || 'Server',
      description: row?.description || '',
      status: row?.status || null,
      is_suspended: !!row?.is_suspended,
      is_transferring: !!row?.is_transferring,
      is_installing: row?.status === 'installing',
      limits: {
        memory: Number(limits.memory) || 0,
        disk: Number(limits.disk) || 0,
        cpu: Number(limits.cpu) || 0,
        swap: Number(limits.swap) || 0,
        io: 0,
        threads: null,
      },
      feature_limits: {
        databases: Number(features.databases) || 0,
        allocations: Number(features.allocations) || 0,
        backups: Number(features.backups) || 0,
      },
      docker_image: row?.image || '',
      node: row?.node_name || '',
      invocation: row?.startup || '',
      created_at: row?.created || null,
      server_owner: row?.is_owner !== false,
      sftp_details: row?.sftp_host ? { ip: row.sftp_host, port: row.sftp_port } : null,
      permissions: row?.permissions || [],
    },
    relationships: {
      egg: { attributes: { name: row?.egg?.name || '' } },
      allocations: {
        data: alloc
          ? [
              {
                attributes: {
                  ip: alloc.ip,
                  port: alloc.port,
                  ip_alias: alloc.ip_alias || '',
                  is_default: alloc.is_primary !== false,
                },
              },
            ]
          : [],
      },
    },
  }
}

export function resources(json) {
  const r = json?.resources || {}
  return {
    current_state: r.state || 'stopped',
    is_suspended: false,
    resources: {
      memory_bytes: Number(r.memory_bytes) || 0,
      memory_limit_bytes: Number(r.memory_limit_bytes) || 0,
      cpu_absolute: Number(r.cpu_absolute) || 0,
      disk_bytes: Number(r.disk_bytes) || 0,
      network_rx_bytes: Number(r.network?.rx_bytes) || 0,
      network_tx_bytes: Number(r.network?.tx_bytes) || 0,
      uptime: Number(r.uptime) || 0,
    },
  }
}

export function websocket(json) {
  if (!json?.token) return null
  return { token: json.token, socket: json.url || '' }
}

export function listOf(json, key) {
  const rows = json?.[key]?.data
  return Array.isArray(rows) ? rows : []
}

export function fileEntries(json) {
  const rows = json?.entries?.data || []
  return rows.map((e) => ({
    name: e.name,
    mode: e.mode,
    mode_bits: e.mode_bits,
    size: Number(e.size) || 0,
    is_file: !!e.file,
    is_symlink: !!e.symlink,
    mimetype: e.mime || '',
    created_at: e.created || null,
    modified_at: e.modified || null,
  }))
}

export function chmodMode(mode) {
  const n = Number(mode)
  return Number.isFinite(n) ? String(n) : String(mode ?? '')
}


export function databaseRows(json) {
  return listOf(json, 'databases').map((d) => ({
    ...d,
    id: d.uuid,
    user: d.username || d.name,
    host: d.host,
    port: d.port,
  }))
}

export function databaseRow(json) {
  const d = json?.database || json?.databases || {}
  return { ...d, id: d.uuid, user: d.username || d.name, host: d.host, port: d.port, password: d.password || '' }
}

export function databaseCreatePayload(payload = {}) {
  return { name: payload.database || payload.name, database_host_uuid: payload.database_host_uuid }
}

export function databaseHosts(json) {
  return listOf(json, 'database_hosts').map((h) => ({
    uuid: h.uuid,
    name: h.name || h.host || h.uuid,
    host: h.host,
    port: h.port,
  }))
}


export function subuserRows(json) {
  return listOf(json, 'subusers').map((s) => ({
    id: s.user?.uuid || s.uuid,
    uuid: s.user?.uuid || s.uuid,
    username: s.user?.username || '',
    email: s.user?.email || s.user?.username || '',
    permissions: s.permissions || [],
    ignored_files: s.ignored_files || [],
    created_at: s.created || null,
    raw: s,
  }))
}

export const subuserRow = (json) => subuserRows(json?.subusers ? json : { subusers: { data: [json] } })[0] || null


export function allocationRows(json) {
  return listOf(json, 'allocations').map((a) => ({
    ...a,
    id: a.uuid,
    is_default: !!a.is_primary,
  }))
}

export const allocationRow = (json) => allocationRows({ allocations: { data: [json?.allocation || json] } })[0] || null


export function backupRows(json) {
  return listOf(json, 'backups').map((b) => ({
    ...b,
    id: b.uuid,
    bytes: Number(b.bytes) || 0,
    created_at: b.created || null,
    completed_at: b.completed || null,
    deletionStatus: b.deletion_status || null,
    is_successful: !!b.is_successful,
    is_locked: !!b.is_locked,
    ignored_files: b.ignored_files || [],
  }))
}

export function backupMeta(json) {
  return {
    count: Number(json?.backups?.total) || 0,
    bytes: Number(json?.backups?.bytes) || undefined,
  }
}


export function startupVariables(json) {
  const rows = json?.variables
  if (!Array.isArray(rows)) return []
  return rows.map((v) => ({
    ...v,
    server_value: v.value ?? '',
    default_value: v.default_value ?? '',
    editable: v.is_editable !== false,
  }))
}


const TRIGGER_LABEL = { cron: 'Cron', power_action: 'Power', server_state: 'State', backup_status: 'Backup' }

export function scheduleTriggerText(triggers) {
  if (!Array.isArray(triggers) || triggers.length === 0) return ''
  return triggers
    .map((t) => (t.type === 'cron' ? `${TRIGGER_LABEL.cron} ${t.schedule || ''}` : TRIGGER_LABEL[t.type] || t.type))
    .join(' · ')
}

export function scheduleRows(json) {
  return listOf(json, 'schedules').map((s) => ({
    id: s.uuid,
    uuid: s.uuid,
    name: s.name,
    is_active: !!s.enabled,
    enabled: !!s.enabled,
    triggers: s.triggers || [],
    condition: s.condition || null,
    trigger_text: scheduleTriggerText(s.triggers),
    last_run_at: s.last_run || null,
    last_failure_at: s.last_failure || null,
    created_at: s.created || null,
    tasks: [],
    raw: s,
  }))
}

export const scheduleRow = (json) => scheduleRows({ schedules: { data: [json?.schedule || json] } })[0] || null

export function scheduleSteps(json) {
  return listOf(json, 'steps')
}

export function scheduleCreatePayload(payload = {}) {
  const out = {}
  if (payload.name !== undefined) out.name = payload.name
  if (payload.enabled !== undefined) out.enabled = !!payload.enabled
  else if (payload.is_active !== undefined) out.enabled = !!payload.is_active

  if (Array.isArray(payload.triggers)) {
    out.triggers = payload.triggers
  } else if (payload.cron) {
    const cron = payload.cron
    const hasCron = ['minute', 'hour', 'day_of_month', 'month', 'day_of_week'].some(
      (k) => cron[k] !== undefined && cron[k] !== null && cron[k] !== '',
    )
    if (hasCron) {
      out.triggers = [
        {
          type: 'cron',
          schedule: [
            cron.second ?? '0',
            cron.minute ?? '*',
            cron.hour ?? '*',
            cron.day_of_month ?? '*',
            cron.month ?? '*',
            cron.day_of_week ?? '*',
          ].join(' '),
        },
      ]
    }
  }
  if (payload.condition) out.condition = payload.condition
  return out
}

export function permissionTree(tree) {
  return Object.fromEntries(
    Object.entries(tree || {}).map(([group, node]) => [
      group,
      { description: node?.description || '', keys: node?.permissions || {} },
    ]),
  )
}
