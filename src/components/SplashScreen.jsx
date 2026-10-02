import { useLayoutEffect } from 'react'


const STATUS = {
  boot: { vi: 'Đang khởi động…', en: 'Starting…' },
  connect: { vi: 'Đang kiểm tra kết nối…', en: 'Checking connection…' },
}

const SUBTITLE = { vi: 'Trình quản lý panel máy chủ', en: 'Server Panel Client' }

export default function SplashScreen({ lang, leaving, status = 'boot', version }) {
  useLayoutEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  const label = STATUS[status]?.[lang] || STATUS[status]?.en || ''

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-splash={leaving ? 'leaving' : 'on'}
      className={`splash-root${leaving ? ' splash-leaving' : ''}`}
    >
      {}
      <div className="splash-blob splash-blob-a" />
      <div className="splash-blob splash-blob-b" />

      <div className="splash-center">
        <div className="splash-glow" />
        <img className="splash-logo" src="./icon.png" alt="" draggable={false} />
        <h1 className="splash-name">CoPanel</h1>
        <p className="splash-sub">{SUBTITLE[lang] || SUBTITLE.en}</p>
      </div>

      <div className="splash-foot">
        <p className="splash-status">{label}</p>
        <div className="splash-track">
          <div className="splash-sweep" />
        </div>
        <p className="splash-version">{version ? `v${version}` : ''}</p>
      </div>
    </div>
  )
}
