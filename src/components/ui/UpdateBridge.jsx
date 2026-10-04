import { useEffect, useRef } from 'react'
import { useApp } from '../../i18n/AppContext'
import { showToast } from '../../lib/toast'
import { initUpdates, subscribeUpdate } from '../../lib/update'

export default function UpdateBridge() {
  const { lang } = useApp()
  const langRef = useRef(lang)
  const lastRef = useRef('')

  useEffect(() => {
    langRef.current = lang
  }, [lang])

  useEffect(() => {
    let unsubIpc = null
    const handle = (s) => {
      if (s.status === lastRef.current) return
      lastRef.current = s.status
      const vi = langRef.current === 'vi'
      const v = s.latestVersion ? `v${s.latestVersion}` : ''
      if (s.status === 'available') {
        showToast(vi ? `Đã có bản cập nhật ${v}` : `Update ${v} is available`, 'info', 6000)
      } else if (s.status === 'downloading') {
        showToast(vi ? `Đang tải bản cập nhật ${v}…` : `Downloading update ${v}…`, 'info', 4000)
      } else if (s.status === 'installing') {
        showToast(vi ? 'Đang cài đặt bản cập nhật — ứng dụng sẽ tự mở lại…' : 'Installing update — the app will restart…', 'success', 5000)
      } else if (s.status === 'error' && s.error) {
        showToast(s.error, 'error')
      }
    }
    const unsub = subscribeUpdate(handle)
    initUpdates().then((u) => {
      unsubIpc = u
    })
    return () => {
      unsub()
      unsubIpc?.()
    }
  }, [])

  return null
}
