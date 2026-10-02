
import { getSession } from './store.js'
import * as clag from './calagopus.js'
import { demoRequest } from './demo.js'

export const ACCEPT = 'application/vnd.pterodactyl.v1+json, application/json'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI


export const isCalagopus = () => getSession().panelType === 'calagopus'

function authPayload() {
  const s = getSession()
  if (s.apiKey) return { mode: 'apikey', key: s.apiKey }
  return { mode: 'none' }
}

export function buildUrl(origin, path, query) {
  const url = new URL(path, origin.endsWith('/') ? origin : `${origin}/`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}


export async function request(path, opts = {}) {
  const { method = 'GET', query, body, timeout, headers: extraHeaders, bare, raw, bodyMode } = opts
  if (getSession().demo) {
    const res = demoRequest(path, { method, query, body })
    if (!res.ok) throw Object.assign(new Error(res.error || 'Demo request failed'), { status: res.status })
    return raw ? res.json : res.json
  }
  const origin = getSession().url
  if (!origin) throw new Error('Not connected to a panel.')

  const url = buildUrl(origin, path, query)
  const mode = bodyMode || (body === undefined || body === null ? 'none' : 'json')

  if (!isElectron) {
    const res = await fetch(url, {
      method,
      headers: {
        ...(bare ? {} : { Accept: ACCEPT }),
        ...(mode === 'json' ? { 'Content-Type': 'application/json' } : {}),
        ...(mode === 'text' ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}),
        ...(extraHeaders || {}),
      },
      body: mode === 'json' ? JSON.stringify(body) : mode === 'text' ? String(body) : undefined,
    })
    const text = await res.text()
    if (raw) {
      if (!res.ok) throw Object.assign(new Error(text.slice(0, 300) || `HTTP ${res.status}`), { status: res.status })
      return text
    }
    let json = null
    try { json = text ? JSON.parse(text) : null } catch {  }
    if (!res.ok) {
      const err = new Error(json?.errors?.[0]?.detail || json?.message || `HTTP ${res.status}`)
      err.status = res.status
      err.body = json
      throw err
    }
    return json
  }

  const res = await window.electronAPI.panelRequest({
    url,
    method,
    headers: { ...(bare ? {} : { Accept: ACCEPT }), ...(extraHeaders || {}) },
    body,
    bodyMode: mode,
    auth: bare ? { mode: 'none' } : authPayload(),
    timeout,
  })

  if (!res.ok) {
    const err = new Error(res.error || 'Request failed')
    err.status = res.status
    err.body = res.json
    err.text = res.text
    throw err
  }
  return raw ? res.text : res.json
}


export const list = (json) => (Array.isArray(json?.data) ? json.data.map((d) => d.attributes) : [])
export const item = (json) => json?.attributes ?? json?.data ?? json ?? null
export const relationships = (json) => (Array.isArray(json?.data) ? json.data[0]?.relationships : json?.relationships) || {}

export async function getAccount() {
  const json = await request('/api/client/account')
  if (isCalagopus()) return clag.account(json)
  return json?.attributes || json || null
}

export async function listServers() {
  if (isCalagopus()) {
    const json = await request('/api/client/servers', { query: { page: 1, per_page: 100 } })
    return clag.listOf(json, 'servers').map(clag.serverRow)
  }
  const json = await request('/api/client', { query: { include: 'egg,subusers' } })
  const rows = Array.isArray(json?.data) ? json.data : []
  return rows.map((row) => ({ attributes: row.attributes, relationships: row.relationships || {} }))
}

export async function getServer(identifier) {
  if (isCalagopus()) {
    const json = await request(`/api/client/servers/${identifier}`)
    return clag.serverRow(json?.server || {})
  }
  const json = await request(`/api/client/servers/${identifier}`, { query: { include: 'egg,subusers' } })
  return { attributes: json?.attributes || {}, relationships: json?.relationships || {} }
}


export async function getResources(identifier) {
  const json = await request(`/api/client/servers/${identifier}/resources`)
  if (isCalagopus()) return clag.resources(json)
  const attrs = json?.attributes || json || {}
  return {
    current_state: attrs.current_state || 'stopped',
    is_suspended: !!attrs.is_suspended,
    resources: attrs.resources || {},
  }
}

export async function power(identifier, signal) {
  return request(`/api/client/servers/${identifier}/power`, { method: 'POST', body: { signal } })
}

export async function sendCommand(identifier, command) {
  return request(`/api/client/servers/${identifier}/command`, { method: 'POST', body: { command } })
}


export async function getWebsocketCredentials(identifier) {
  const json = await request(`/api/client/servers/${identifier}/websocket`, { timeout: 15000 })
  if (isCalagopus()) return clag.websocket(json)
  return json?.data || json || null
}


export async function getActivity(identifier, filters) {
  const json = await request(`/api/client/servers/${identifier}/activity`, { query: filters })
  if (isCalagopus()) {
    return clag.listOf(json, 'activities').map((r) => ({
      id: r.created,
      event: r.event,
      timestamp: r.created,
      properties: r.data || {},
      ...r,
    }))
  }
  const rows = Array.isArray(json?.data) ? json.data : []
  return rows.map((r) => ({ id: r.id, batch_uuid: r.batch_uuid, ...(r.attributes || {}), ...r }))
}

const filesBase = (id) => `/api/client/servers/${id}/files`


export const listFiles = (id, directory) =>
  request(`${filesBase(id)}/list`, { query: { directory } }).then((json) => {
    if (isCalagopus()) return clag.fileEntries(json)
    return Array.isArray(json) ? json : list(json)
  })


export const readFile = (id, file) => request(`${filesBase(id)}/contents`, { query: { file }, raw: true })


export const writeFile = (id, file, content) =>
  request(`${filesBase(id)}/write`, {
    method: 'POST',
    query: { file },
    body: String(content ?? ''),
    bodyMode: 'text',
  })


export const deleteFiles = (id, root, files) =>
  request(`${filesBase(id)}/delete`, { method: 'POST', body: { root, files } })

export const createFolder = (id, root, name) =>
  request(`${filesBase(id)}/${isCalagopus() ? 'create-directory' : 'create-folder'}`, {
    method: 'POST',
    body: { root, name },
  })

export const createFile = (id, path) => writeFile(id, path, '')


export const renameFile = (id, root, from, to) =>
  request(`${filesBase(id)}/rename`, { method: 'PUT', body: { root, files: [{ from, to }] } })


export const copyFile = (id, path, to) =>
  request(`${filesBase(id)}/copy`, {
    method: 'POST',
    body: isCalagopus()
      ? { path, destination: to || null, foreground: true }
      : { location: to || path },
  })


export const compressFiles = (id, root, files) =>
  request(`${filesBase(id)}/compress`, {
    method: 'POST',
    body: isCalagopus() ? { root, files, format: 'tar.gz' } : { root, files },
  })

export const decompressFile = (id, root, file) =>
  request(`${filesBase(id)}/decompress`, { method: 'POST', body: { root, file } })


export const chmodFile = (id, root, entries) =>
  request(`${filesBase(id)}/chmod`, {
    method: isCalagopus() ? 'PUT' : 'POST',
    body: {
      root,
      files: isCalagopus()
        ? entries.map((e) => ({ file: e.file, mode: clag.chmodMode(e.mode) }))
        : entries,
    },
  })


export async function downloadFile(id, file) {
  const json = await request(`${filesBase(id)}/download`, { query: { file } })
  return json?.attributes?.url || json?.url || null
}


export async function uploadFile(id, directory, name, bytes) {
  const json = await request(`${filesBase(id)}/upload`, { method: 'GET' })
  const target = json?.attributes?.url || json?.url
  if (!target) throw new Error('The panel did not return an upload URL.')

  const sep = target.includes('?') ? '&' : '?'
  const url = directory && directory !== '/' ? `${target}${sep}directory=${encodeURIComponent(directory)}` : target

  const res = await window.electronAPI.panelUpload({
    url,
    directory: directory || '/',
    name,
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  })
  if (!res?.ok) throw new Error(res?.error || 'Upload failed.')
  return true
}

const dbBase = (id) => `/api/client/servers/${id}/databases`

const normDb = (d = {}) => ({
  ...d,
  user: d.username || d.name,
  host: typeof d.host === 'object' && d.host ? d.host.address : d.host,
  port: typeof d.host === 'object' && d.host ? d.host.port : d.port,
})


export const listDatabases = (id) =>
  request(dbBase(id)).then((json) => (isCalagopus() ? clag.databaseRows(json) : list(json).map(normDb)))


export const listDatabaseHosts = (id) =>
  request(`${dbBase(id)}/hosts`).then((json) => clag.databaseHosts(json))


export const createDatabase = (id, payload) =>
  request(dbBase(id), { method: 'POST', body: isCalagopus() ? clag.databaseCreatePayload(payload) : payload }).then(
    (json) =>
      isCalagopus()
        ? clag.databaseRow(json)
        : {
            ...normDb(item(json) || {}),
            password: json?.relationships?.password?.attributes?.password || '',
          },
  )

export const rotateDatabasePassword = (id, database, password) =>
  request(`${dbBase(id)}/${database}/rotate-password`, {
    method: 'POST',
    body: password ? { password } : {},
  }).then((json) => {
    if (isCalagopus()) return clag.databaseRow(json)
    const attrs = item(json) || {}
    const pwd = json?.relationships?.password?.attributes?.password
    return { ...attrs, password: pwd || '' }
  })

export const deleteDatabase = (id, database) =>
  request(`${dbBase(id)}/${database}`, { method: 'DELETE' })

const schedBase = (id) => `/api/client/servers/${id}/schedules`

const normSchedule = (row = {}) => ({
  ...row,
  tasks: Array.isArray(row.relationships?.tasks?.data)
    ? row.relationships.tasks.data.map((t) => t.attributes).filter(Boolean)
    : Array.isArray(row.tasks)
      ? row.tasks
      : [],
})


export async function listSchedules(id) {
  const json = await request(schedBase(id))
  if (isCalagopus()) return clag.scheduleRows(json)
  return (Array.isArray(json?.data) ? json.data : []).map((row) =>
    normSchedule({ ...(row.attributes || {}), relationships: row.relationships || {} }),
  )
}
export const getSchedule = (id, schedule) =>
  request(`${schedBase(id)}/${schedule}`).then((json) =>
    isCalagopus() ? clag.scheduleRow(json) : normSchedule(json || {}),
  )
export const createSchedule = (id, payload) =>
  request(schedBase(id), { method: 'POST', body: isCalagopus() ? clag.scheduleCreatePayload(payload) : payload })
    .then((json) => (isCalagopus() ? clag.scheduleRow(json) : normSchedule(item(json) || {})))
export const updateSchedule = (id, schedule, payload) =>
  request(`${schedBase(id)}/${schedule}`, {
    method: isCalagopus() ? 'PATCH' : 'POST',
    body: isCalagopus() ? clag.scheduleCreatePayload(payload) : payload,
  }).then((json) => (isCalagopus() ? clag.scheduleRow(json) : normSchedule(item(json) || {})))
export const executeSchedule = (id, schedule) =>
  request(`${schedBase(id)}/${schedule}/${isCalagopus() ? 'trigger' : 'execute'}`, { method: 'POST' })
export const deleteSchedule = (id, schedule) => request(`${schedBase(id)}/${schedule}`, { method: 'DELETE' })


const clagStepsUnsupported = () => {
  throw new Error('Calagopus schedule steps are managed on the panel.')
}

export const createScheduleTask = (id, schedule, payload) => {
  if (isCalagopus()) return clagStepsUnsupported()
  return request(`${schedBase(id)}/${schedule}/tasks`, { method: 'POST', body: payload }).then(item)
}
export const updateScheduleTask = (id, schedule, task, payload) => {
  if (isCalagopus()) return clagStepsUnsupported()
  return request(`${schedBase(id)}/${schedule}/tasks/${task}`, { method: 'POST', body: payload }).then(item)
}
export const deleteScheduleTask = (id, schedule, task) => {
  if (isCalagopus()) return clagStepsUnsupported()
  return request(`${schedBase(id)}/${schedule}/tasks/${task}`, { method: 'DELETE' })
}


const netBase = (id) =>
  `/api/client/servers/${id}/${isCalagopus() ? 'allocations' : 'network/allocations'}`

export const listAllocations = (id) =>
  request(netBase(id)).then((json) => (isCalagopus() ? clag.allocationRows(json) : list(json)))

export const createAllocation = (id) =>
  request(netBase(id), { method: 'POST' }).then((json) => (isCalagopus() ? clag.allocationRow(json) : item(json)))
export const updateAllocation = (id, allocation, payload) =>
  request(`${netBase(id)}/${allocation}`, {
    method: isCalagopus() ? 'PATCH' : 'POST',
    body: payload,
  }).then((json) => (isCalagopus() ? clag.allocationRow(json) : item(json)))
export const setPrimaryAllocation = (id, allocation) =>
  isCalagopus()
    ? request(`${netBase(id)}/${allocation}`, { method: 'PATCH', body: { primary: true } })
    : request(`${netBase(id)}/${allocation}/primary`, { method: 'POST' })
export const deleteAllocation = (id, allocation) =>
  request(`${netBase(id)}/${allocation}`, { method: 'DELETE' })

const userBase = (id) => `/api/client/servers/${id}/${isCalagopus() ? 'subusers' : 'users'}`

export const listUsers = (id) =>
  request(userBase(id)).then((json) => (isCalagopus() ? clag.subuserRows(json) : list(json)))
export const getUser = (id, user) =>
  request(`${userBase(id)}/${user}`).then((json) => (isCalagopus() ? clag.subuserRow(json) : item(json)))
export const createUser = (id, payload) =>
  request(userBase(id), {
    method: 'POST',
    body: isCalagopus()
      ? { email: payload.email, permissions: payload.permissions || [], ignored_files: payload.ignored_files || [] }
      : payload,
  }).then((json) => (isCalagopus() ? clag.subuserRow(json) : item(json)))
export const updateUser = (id, user, payload) =>
  request(`${userBase(id)}/${user}`, {
    method: isCalagopus() ? 'PATCH' : 'POST',
    body: isCalagopus()
      ? { permissions: payload.permissions || [], ignored_files: payload.ignored_files || [] }
      : payload,
  }).then((json) => (isCalagopus() ? clag.subuserRow(json) : item(json)))
export const deleteUser = (id, user) => request(`${userBase(id)}/${user}`, { method: 'DELETE' })

const backupBase = (id) => `/api/client/servers/${id}/backups`

export async function listBackups(id) {
  const json = await request(backupBase(id), { query: { per_page: 50 } })
  if (isCalagopus()) return clag.backupRows(json)
  return Array.isArray(json?.data) ? json.data.map((d) => d.attributes).filter(Boolean) : []
}


export async function listBackupsPaged(id) {
  const json = await request(backupBase(id), { query: { per_page: 50 } })
  if (isCalagopus()) {
    const meta = clag.backupMeta(json)
    return { backups: clag.backupRows(json), count: meta.count }
  }
  return {
    backups: Array.isArray(json?.data) ? json.data.map((d) => d.attributes).filter(Boolean) : [],
    count: json?.meta?.backup_count ?? json?.meta?.pagination?.total ?? 0,
  }
}

export const createBackup = (id, payload) =>
  request(backupBase(id), {
    method: 'POST',
    body: isCalagopus() ? { name: payload?.name, ignored_files: payload?.ignored_files || [] } : payload,
  }).then((json) => (isCalagopus() ? clag.backupRows({ backups: { data: [json?.backup || json] } })[0] : item(json)))
export const getBackup = (id, backup) =>
  request(`${backupBase(id)}/${backup}`).then((json) =>
    isCalagopus() ? clag.backupRows({ backups: { data: [json?.backup || json] } })[0] : item(json),
  )


export const restoreBackup = (id, backup, { truncate = true } = {}) =>
  request(`${backupBase(id)}/${backup}/restore`, {
    method: 'POST',
    body: isCalagopus() ? { truncate_directory: !!truncate, restore_startup: false } : { truncate: !!truncate },
  })


export const toggleBackupLock = (id, backup, locked) =>
  request(`${backupBase(id)}/${backup}`, {
    method: isCalagopus() ? 'PATCH' : 'POST',
    body: isCalagopus() ? { locked: !!locked } : undefined,
  })

export const deleteBackup = (id, backup) => request(`${backupBase(id)}/${backup}`, { method: 'DELETE' })
export async function downloadBackup(id, backup) {
  const json = await request(`${backupBase(id)}/${backup}/download`, { timeout: 60000 })
  return json?.attributes?.url || json?.url || null
}

export async function getStartup(id) {
  if (isCalagopus()) {
    const [vars, srv] = await Promise.all([
      request(`/api/client/servers/${id}/startup/variables`),
      request(`/api/client/servers/${id}`),
    ])
    return {
      variables: clag.startupVariables(vars),
      meta: { startup_command: srv?.server?.startup || '' },
    }
  }
  const json = await request(`/api/client/servers/${id}/startup`)
  return {
    variables: list(json),
    meta: json?.meta || {},
  }
}

export const setStartupVariable = (id, key, value) =>
  isCalagopus()
    ? request(`/api/client/servers/${id}/startup/variables`, {
        method: 'PUT',
        body: { variables: [{ env_variable: key, value: String(value ?? '') }] },
      })
    : request(`/api/client/servers/${id}/startup/variable`, { method: 'PUT', body: { key, value } })

export const renameServer = (id, name) =>
  request(`/api/client/servers/${id}/settings/rename`, { method: 'POST', body: { name } })

export const reinstallServer = (id) =>
  isCalagopus()
    ? request(`/api/client/servers/${id}/settings/install`, {
        method: 'POST',
        body: { truncate_directory: false },
      })
    : request(`/api/client/servers/${id}/settings/reinstall`, { method: 'POST' })

export const setDockerImage = (id, image) =>
  request(`/api/client/servers/${id}/${isCalagopus() ? 'startup/docker-image' : 'settings/docker-image'}`, {
    method: 'PUT',
    body: { image },
  })


export const getPermissions = () =>
  request('/api/client/permissions').then((json) => {
    if (!isCalagopus()) return json
    return { ...json, permissions: clag.permissionTree(json?.server_permissions) }
  })
