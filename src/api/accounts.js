const ACCOUNT_SECRET_PREFIX = 'panelApiKey_'

function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI
}

async function readSettings() {
  if (!isElectron()) return {}
  try {
    return await window.electronAPI.getSettings()
  } catch {
    return {}
  }
}

async function writeAccounts(next) {
  if (!isElectron()) return []
  const settings = await readSettings()
  const updated = { ...settings, accounts: next || [] }
  await window.electronAPI.saveSettings(updated)
  return next || []
}

export async function listAccounts() {
  const settings = await readSettings()
  const accounts = Array.isArray(settings?.accounts) ? settings.accounts : []
  return accounts.map((a) => ({ ...a, apiKey: undefined }))
}

export async function saveAccount(entry) {
  const list = await listAccounts()
  const existing = list.find((a) => a.id === entry.id)
  let updated

  if (entry.apiKey !== undefined && entry.apiKey !== null && entry.apiKey !== '') {
    const secretName = `${ACCOUNT_SECRET_PREFIX}${entry.id}`
    await window.electronAPI.setSecret(secretName, entry.apiKey)
  }

  if (existing) {
    updated = list.map((a) =>
      a.id === entry.id
        ? {
            id: entry.id,
            label: entry.label ?? existing.label,
            panelType: entry.panelType ?? existing.panelType,
            url: entry.url ?? existing.url,
            account: entry.account ?? existing.account,
            createdAt: existing.createdAt,
          }
        : a,
    )
  } else {
    const safeLabel = entry.label || `${entry.panelType} — ${entry.url}`
    updated = [
      ...list,
      {
        id: entry.id,
        label: safeLabel,
        panelType: entry.panelType,
        url: entry.url,
        account: entry.account,
        createdAt: Date.now(),
      },
    ]
  }

  return writeAccounts(updated)
}

export async function deleteAccount(id) {
  const list = await listAccounts()
  const filtered = list.filter((a) => a.id !== id)
  await writeAccounts(filtered)

  if (isElectron()) {
    const secretName = `${ACCOUNT_SECRET_PREFIX}${id}`
    await window.electronAPI.setSecret(secretName, '')
  }
  return filtered
}

export async function getAccountApiKey(id) {
  if (!isElectron()) return ''
  const secretName = `${ACCOUNT_SECRET_PREFIX}${id}`
  try {
    return await window.electronAPI.getSecret(secretName)
  } catch {
    return ''
  }
}
