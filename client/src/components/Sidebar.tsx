import type { Ref } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { navItems } from '../data/navigation'

interface SidebarProps {
  id: string
  open: boolean
  onClose: () => void
  closeButtonRef: Ref<HTMLButtonElement>
}

export function Sidebar({ id, open, onClose, closeButtonRef }: SidebarProps) {
  return (
    <aside id={id} className="sidebar" data-open={open}>
      <div className="sidebar__header">
        {/* A plain Link: a NavLink to "/" would be marked as the current page on every route. */}
        <Link to="/" className="sidebar__brand" onClick={onClose}>
          <span className="sidebar__logo" aria-hidden="true">
            LC
          </span>
          ProjectHub
        </Link>
        <button ref={closeButtonRef} type="button" className="icon-btn sidebar__close" onClick={onClose} aria-label="Close menu">
          <Icon name="close" />
        </button>
      </div>
      <nav className="sidebar__nav" aria-label="Main">
        <ul>
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end={item.path === '/'} className="nav-link" onClick={onClose}>
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <p className="sidebar__footer">Loughborough College IT Projects. Demonstration build with fictional data.</p>
    </aside>
  )
}
