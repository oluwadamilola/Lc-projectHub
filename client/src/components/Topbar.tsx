import type { Ref } from 'react'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'
import { demoUser } from '../data/demoData'

interface TopbarProps {
  title: string
  menuId: string
  menuOpen: boolean
  onMenuClick: () => void
  menuButtonRef: Ref<HTMLButtonElement>
}

export function Topbar({ title, menuId, menuOpen, onMenuClick, menuButtonRef }: TopbarProps) {
  return (
    <header className="topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="icon-btn topbar__menu"
        onClick={onMenuClick}
        aria-label="Open menu"
        aria-controls={menuId}
        aria-expanded={menuOpen}
      >
        <Icon name="menu" />
      </button>
      <p className="topbar__title">{title}</p>
      <ThemeToggle />
      <div className="user-chip">
        <span className="user-chip__avatar" aria-hidden="true">
          {demoUser.initials}
        </span>
        <span className="user-chip__name">{demoUser.name}</span>
      </div>
    </header>
  )
}
