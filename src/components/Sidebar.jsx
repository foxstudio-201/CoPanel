
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  House, Gear, List, Terminal, Files, Database, Clock, Users, UsersThree, Archive,
  Network, Play, GearSix, ArrowLeft, ChartLineUp, SidebarSimple,
} from '@phosphor-icons/react'
import { t } from '../i18n/translations'
import { statusColor } from './HomePage'

export const RAIL_W = 180
export const RAIL_W_COLLAPSED = 64

const ACCENT = '#a78bfa'
const ICON = 20
const LABEL_W = 124 
const FILLET = 14 
const EDGE = 8 
const RADIUS = 10 
const HOOK = 14 
const GAP = 12 
const SWEEP_MS = 300
const SWEEP = `${SWEEP_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
const LINE_TOP = -44

const SERVER_PANEL_PAGES = [
  { key: 'server-overview', icon: ChartLineUp, label: 'Overview', labelVi: 'Tổng quan' },
  { key: 'server-console', icon: Terminal, label: 'Console', labelVi: 'Bảng điều khiển' },
  { key: 'server-players', icon: UsersThree, label: 'Players', labelVi: 'Người chơi' },
  { key: 'server-files', icon: Files, label: 'Files', labelVi: 'Tệp tin' },
  { key: 'server-databases', icon: Database, label: 'Databases', labelVi: 'Cơ sở dữ liệu' },
  { key: 'server-schedules', icon: Clock, label: 'Schedules', labelVi: 'Lịch trình' },
  { key: 'server-users', icon: Users, label: 'Users', labelVi: 'Người dùng' },
  { key: 'server-backups', icon: Archive, label: 'Backups', labelVi: 'Sao lưu' },
  { key: 'server-network', icon: Network, label: 'Network', labelVi: 'Mạng' },
  { key: 'server-startup', icon: Play, label: 'Startup', labelVi: 'Khởi động' },
  { key: 'server-settings', icon: GearSix, label: 'Settings', labelVi: 'Cài đặt' },
]

export default function Sidebar({
  theme, lang, version,
  servers, selectedServer, dropdownOpen, onToggleDropdown, onSelectServer,
  isInServerPanel, displayPage, activePage, onNavigate, onBack,
  collapsed, onToggleCollapsed,
}) {
  const navRef = useRef(null)
  const listRef = useRef(null)
  const [pill, setPill] = useState({ y: 0, h: 0, show: false })

  const sidebarBg = theme === 'light' ? '#f5f5f5' : '#0a0a0a'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const pillBg = theme === 'light' ? '#ece8f6' : '#1d1927'
  const handleBg = theme === 'light' ? '#ffffff' : '#1a1a1a'

  const activeKey = isInServerPanel ? displayPage : activePage
  const railW = collapsed ? RAIL_W_COLLAPSED : RAIL_W

  const measure = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const el = nav.querySelector(`[data-nav-key="${activeKey}"]`)
    if (!el) {
      setPill((p) => (p.show ? { ...p, show: false } : p))
      return
    }
    const navBox = nav.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const group = el.closest('[data-nav-group]')
    const rows = group ? [...group.querySelectorAll('[data-nav-row]')] : []
    setPill({
      y: box.top - navBox.top,
      h: box.height,
      show: true,
      flareTop: rows.length > 0 && rows[0] !== el,
      flareBottom: rows.length > 0 && rows[rows.length - 1] !== el,
    })
  }, [activeKey])

  useLayoutEffect(() => {
    measure()
  }, [measure, collapsed, lang, servers.length, isInServerPanel, version, dropdownOpen])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    list.addEventListener('scroll', measure, { passive: true })
    return () => list.removeEventListener('scroll', measure)
  }, [measure])

  useEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => measure())
    for (const group of nav.querySelectorAll('[data-nav-group]')) observer.observe(group)
    return () => observer.disconnect()
  }, [measure])

  const rowClass = (tall, extra = '') =>
    `group relative w-full shrink-0 flex items-center pl-5.5 pr-3.5 text-left cursor-pointer ` +
    `[&:first-of-type_.flare-top]:hidden [&:last-of-type_.flare-bottom]:hidden ` +
    `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] ` +
    `${tall ? 'h-10' : 'h-9'} ${extra}`

  const flare = (top, bottom, color) => (
    <>
      {top && (
        <span
          className="flare-top absolute right-0"
          style={{
            width: FILLET,
            height: FILLET,
            top: -FILLET,
            background: `radial-gradient(circle at 0% 0%, transparent ${FILLET}px, ${color} ${FILLET}px)`,
          }}
        />
      )}
      {bottom && (
        <span
          className="flare-bottom absolute right-0"
          style={{
            width: FILLET,
            height: FILLET,
            bottom: -FILLET,
            background: `radial-gradient(circle at 0% 100%, transparent ${FILLET}px, ${color} ${FILLET}px)`,
          }}
        />
      )}
    </>
  )

  const block = (color) => (
    <span
      className="absolute inset-y-0 left-0 right-0"
      style={{
        background: color,
        borderTopLeftRadius: RADIUS,
        borderBottomLeftRadius: RADIUS,
      }}
    />
  )

  const blockOutline = (color, flareTop, flareBottom) => (
    <>
      <span
        className="absolute inset-y-0 left-0"
        style={{
          right: FILLET + 1,
          border: `1px solid ${color}`,
          borderRight: 'none',
          borderTopLeftRadius: RADIUS,
          borderBottomLeftRadius: RADIUS,
        }}
      />
      {!flareTop && (
        <span className="absolute right-0" style={{ top: 0, width: FILLET + 1, height: 1, background: color }} />
      )}
      {!flareBottom && (
        <span className="absolute right-0" style={{ bottom: 0, width: FILLET + 1, height: 1, background: color }} />
      )}
    </>
  )

  const flareOutline = (top, bottom, color) => (
    <>
      {top && (
        <span
          className="flare-top absolute"
          style={{
            right: 1, width: FILLET, height: FILLET, top: -FILLET,
            border: `1px solid ${color}`,
            borderTop: 'none',
            borderLeft: 'none',
            borderBottomRightRadius: '100%',
          }}
        />
      )}
      {bottom && (
        <span
          className="flare-bottom absolute"
          style={{
            right: 1, width: FILLET, height: FILLET, bottom: -FILLET,
            border: `1px solid ${color}`,
            borderBottom: 'none',
            borderLeft: 'none',
            borderTopRightRadius: '100%',
          }}
        />
      )}
    </>
  )

  const rowTint = () => (
    <span aria-hidden className="absolute inset-y-0 right-[-1px]" style={{ left: EDGE }}>
      {block(pillBg)}
      {flare(true, true, pillBg)}
    </span>
  )

  const hoverBar = (inset = EDGE) => (
    <span
      aria-hidden
      className="nav-bar-grow absolute rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      style={{ left: inset, width: 3, height: 18, top: 'calc(50% - 9px)', background: ACCENT }}
    />
  )

  const label = (text, active) => (
    <span
      className="relative z-20 overflow-hidden whitespace-nowrap"
      style={{ maxWidth: collapsed ? 0 : LABEL_W, transition: `max-width ${SWEEP}` }}
    >
      <span className={`pl-2.5 text-xs ${active ? 'font-semibold' : 'font-medium'}`}>{text}</span>
    </span>
  )

  const navKeyProps = (key, text) => ({
    'data-nav-key': key,
    'data-tip': collapsed ? text : undefined,
    'aria-current': activeKey === key ? 'page' : undefined,
  })

  const list = (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5">
      {isInServerPanel ? (
        SERVER_PANEL_PAGES.map((p) => {
          const Icon = p.icon
          const text = lang === 'vi' ? p.labelVi : p.label
          const isActive = activeKey === p.key
          return (
            <button
              type="button"
              key={p.key}
              onClick={() => onNavigate(p.key)}
              {...navKeyProps(p.key, text)}
              data-nav-row
              className={rowClass(false)}
              style={{ color: isActive ? ACCENT : labelColor }}
            >
              {!isActive && hoverBar()}
              <Icon size={ICON} weight="duotone" className="relative z-20 shrink-0" />
              {label(text, isActive)}
            </button>
          )
        })
      ) : (
        <button
          type="button"
          onClick={() => onNavigate('servers')}
          {...navKeyProps('servers', t(lang, 'sidebar.home'))}
          data-nav-row
          className={rowClass(true)}
          style={{ color: activeKey === 'servers' ? ACCENT : labelColor }}
        >
          {activeKey !== 'servers' && hoverBar()}
          <House size={ICON} weight="duotone" className="relative z-20 shrink-0" />
          {label(t(lang, 'sidebar.home'), activeKey === 'servers')}
        </button>
      )}
    </div>
  )

  return (
    <nav
      ref={navRef}
      className="absolute left-0 top-11 bottom-0 z-50 flex flex-col py-3"
      data-surface
      style={{ width: railW, background: sidebarBg, gap: GAP, transition: `width ${SWEEP}` }}
    >
      {}
      <div
        aria-hidden
        className="absolute z-10 pointer-events-none"
        style={{
          left: EDGE,
          right: -1,
          top: 0,
          height: pill.h,
          opacity: pill.show ? 1 : 0,
          transform: `translateY(${pill.y}px)`,
          transition: `transform ${SWEEP}, height ${SWEEP}, opacity 150ms linear`,
        }}
      >
        {}
        <span className="absolute inset-0">
          {isInServerPanel ? (
            <>
              {}
              <span
                aria-hidden
                className="absolute"
                style={{
                  right: 0,
                  width: 4,
                  top: pill.flareTop ? -FILLET : 0,
                  bottom: pill.flareBottom ? -FILLET : 0,
                  background: sidebarBg,
                }}
              />
              {blockOutline(borderColor, pill.flareTop, pill.flareBottom)}
              {flareOutline(pill.flareTop, pill.flareBottom, borderColor)}
            </>
          ) : (
            <>
              {block(pillBg)}
              {flare(pill.flareTop, pill.flareBottom, pillBg)}
            </>
          )}
        </span>
      </div>

      {}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        data-tip={t(lang, collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
        className="absolute top-[14px] left-[calc(100%-12px)] z-50 w-6 h-6 rounded-md flex items-center justify-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
        style={{ background: handleBg, border: `1px solid ${borderColor}`, color: labelColor }}
      >
        <SidebarSimple
          size={14}
          weight="duotone"
          className={`transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
        />
      </button>

      {}
      <div data-nav-group className="relative shrink-0 flex flex-col gap-1 pb-2">
        <span
          aria-hidden
          className="absolute right-0 w-px pointer-events-none"
          style={{ top: LINE_TOP, bottom: HOOK, background: borderColor }}
        />
        <span
          aria-hidden
          className="absolute left-0 right-0 bottom-0 h-3.5 border-b border-r rounded-br-[14px] pointer-events-none"
          style={{ borderColor }}
        />

        {servers.length > 0 && (
          <div className="shrink-0">
            <button
              type="button"
              onClick={onToggleDropdown}
              aria-expanded={dropdownOpen}
              data-tip={collapsed ? (selectedServer?.name || (lang === 'vi' ? 'Chọn server' : 'Select server')) : undefined}
              data-nav-row
              className={rowClass(true)}
              style={{ color: dropdownOpen ? ACCENT : labelColor }}
            >
              {dropdownOpen ? rowTint() : hoverBar()}
              {selectedServer ? (
                <>
                  <img
                    src={selectedServer.game === 'terraria' ? './terraria_slot.png' : './Minecraft_slot.png'}
                    alt=""
                    className="relative z-20 w-5 h-5 rounded object-cover shrink-0"
                  />
                  {label(selectedServer.name, false)}
                </>
              ) : (
                <>
                  <List size={ICON} weight="duotone" className="relative z-20 shrink-0" />
                  {label(lang === 'vi' ? 'Chọn server' : 'Select server', false)}
                </>
              )}
              {!collapsed && (
                <svg
                  className={`relative z-20 w-3 h-3 ml-auto shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  style={{ color: labelColor }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>

            {}
            <div
              className="grid transition-[grid-template-rows] duration-300"
              style={{
                gridTemplateRows: dropdownOpen ? '1fr' : '0fr',
                transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div className="overflow-hidden">
                <div className="mt-1 rounded-[10px] border p-1" style={{ borderColor }}>
                  {}
                  <div className="max-h-[188px] overflow-y-auto overflow-x-hidden flex flex-col gap-0.5">
                    {servers.map((srv) => {
                      const isSelected = selectedServer?.id === srv.id
                      return (
                        <button
                          type="button"
                          key={srv.id || srv.uuid}
                          onClick={() => onSelectServer(srv)}
                          data-tip={collapsed ? srv.name : undefined}
                          className="group relative w-full shrink-0 flex items-center h-9 pl-2 pr-2 rounded-lg text-left cursor-pointer"
                          style={{ color: isSelected ? ACCENT : labelColor, background: isSelected ? pillBg : undefined }}
                        >
                          {!isSelected && hoverBar(4)}
                          <img
                            src={srv.game === 'terraria' ? './terraria_slot.png' : './Minecraft_slot.png'}
                            alt=""
                            className="relative z-20 w-5 h-5 rounded object-cover shrink-0"
                          />
                          {label(srv.name, isSelected)}
                          <span
                            className="relative z-20 ml-auto w-2 h-2 rounded-full shrink-0"
                            style={{ background: statusColor(srv.status) }}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isInServerPanel && (
          <button
            type="button"
            onClick={onBack}
            data-tip={collapsed ? t(lang, 'sidebar.home') : undefined}
            data-nav-row
            className={rowClass(true)}
            style={{ color: labelColor }}
          >
            {hoverBar()}
            <ArrowLeft size={ICON} weight="duotone" className="relative z-20 shrink-0" />
            {label(t(lang, 'sidebar.home'), false)}
          </button>
        )}
      </div>

      {}
      <div data-nav-group className="relative flex-1 min-h-0 flex flex-col py-3.5">
        <span
          aria-hidden
          className="absolute left-0 right-0 top-0 h-3.5 border-t border-r rounded-tr-[14px] pointer-events-none"
          style={{ borderColor }}
        />
        <span
          aria-hidden
          className="absolute right-0 w-px pointer-events-none"
          style={{ top: HOOK, bottom: HOOK, background: borderColor }}
        />
        <span
          aria-hidden
          className="absolute left-0 right-0 bottom-0 h-3.5 border-b border-r rounded-br-[14px] pointer-events-none"
          style={{ borderColor }}
        />
        {list}
      </div>

      {}
      <div data-nav-group className="relative shrink-0 flex flex-col gap-1 pt-2">
        <span
          aria-hidden
          className="absolute left-0 right-0 top-0 h-3.5 border-t border-r rounded-tr-[14px] pointer-events-none"
          style={{ borderColor }}
        />
        <span
          aria-hidden
          className="absolute right-0 w-px pointer-events-none"
          style={{ top: HOOK, bottom: 0, background: borderColor }}
        />

        <button
          type="button"
          onClick={() => onNavigate('settings')}
          {...navKeyProps('settings', t(lang, 'sidebar.settings'))}
          data-nav-row
          className={rowClass(true)}
          style={{ color: activeKey === 'settings' ? ACCENT : labelColor }}
        >
          {activeKey !== 'settings' && hoverBar()}
          <Gear size={ICON} weight="duotone" className="relative z-20 shrink-0" />
          {label(t(lang, 'sidebar.settings'), activeKey === 'settings')}
        </button>

        <span
          className="text-[9px] font-mono leading-none whitespace-nowrap select-none overflow-hidden self-center"
          style={{ color: labelColor, maxWidth: collapsed ? 0 : 60, transition: `max-width ${SWEEP}` }}
        >
          {version ? `v${version}` : 'v1.0.0'}
        </span>
      </div>
    </nav>
  )
}
