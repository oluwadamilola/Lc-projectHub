import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { navItems } from '../data/navigation'

const SIDEBAR_ID = 'app-sidebar'
/** Must match the breakpoint in layout.css where the sidebar becomes permanent (60rem). */
const DESKTOP_QUERY = '(min-width: 60rem)'

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const { pathname } = useLocation()
  const title =
    navItems.find((item) =>
      item.path === '/' ? pathname === '/' : pathname === item.path || pathname.startsWith(`${item.path}/`),
    )?.label ?? 'Not found'

  useEffect(() => {
    document.title = `${title} | LC ProjectHub`
  }, [title])

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  // If the window grows to desktop width the sidebar is permanent, so drop the drawer state.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Keyboard users: move focus into the drawer when it opens and back to the menu button when it closes.
  useEffect(() => {
    if (menuOpen) closeButtonRef.current?.focus()
    else if (wasOpen.current) menuButtonRef.current?.focus()
    wasOpen.current = menuOpen
  }, [menuOpen])

  return (
    <div className="app-shell">
      {/* While the drawer is open everything outside it is inert, so Tab cannot reach the page behind. */}
      <a className="skip-link" href="#main-content" inert={menuOpen}>
        Skip to main content
      </a>
      <Sidebar
        id={SIDEBAR_ID}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        closeButtonRef={closeButtonRef}
      />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="main" inert={menuOpen}>
        <Topbar
          title={title}
          menuId={SIDEBAR_ID}
          menuOpen={menuOpen}
          onMenuClick={() => setMenuOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
