import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { Task } from '@lc-projecthub/shared'
import { Icon } from './Icon'

interface TaskActionsMenuProps {
  task: Pick<Task, 'id' | 'projectId' | 'title'>
  /** Called when "Delete task" is chosen. The caller opens its confirmation; nothing is deleted here. */
  onDelete: () => void
}

/** Room the menu needs below the button before it opens upwards instead. */
const MENU_HEIGHT_ALLOWANCE = 112
const GAP = 4
const EDGE = 8

interface Placement {
  right: number
  top?: number
  bottom?: number
}

/*
  Only one task menu is open at a time. Clicking elsewhere already closes the open one; this also covers
  opening a second menu without a pointer (for example from a screen reader, which sends only a click).
*/
let activeMenu: { id: string; closeQuietly: () => void } | null = null

/**
 * The actions for one task row (Edit task, Delete task) behind a single "⋮" button.
 *
 * Keyboard: Enter, Space or Down opens it on the first action (Up on the last); Up, Down, Home and End move;
 * Escape closes it and returns focus to the button; Tab closes it and carries on to the next control.
 * The list is drawn in the page body, positioned beside the button, so the scrolling table cannot clip it.
 */
export function TaskActionsMenu({ task, onDelete }: TaskActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement>({ right: EDGE })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Which action takes focus when the menu opens: the first (mouse, Enter, Down) or the last (Up).
  const startAtRef = useRef<'first' | 'last'>('first')
  // Where the button was when the menu opened, to tell a scroll that moved it from a late event that did not.
  const openedAtRef = useRef({ top: 0, left: 0 })
  const menuId = useId()

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  /** Closes without moving focus: used when something else took over (another menu, a click elsewhere). */
  const closeQuietly = useCallback(() => setOpen(false), [])
  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false)
      if (activeMenu?.id === menuId) activeMenu = null
      if (restoreFocus) triggerRef.current?.focus()
    },
    [menuId],
  )

  function openMenu(startAt: 'first' | 'last') {
    const button = triggerRef.current
    if (!button) return
    if (activeMenu && activeMenu.id !== menuId) activeMenu.closeQuietly()
    activeMenu = { id: menuId, closeQuietly }
    const rect = button.getBoundingClientRect()
    openedAtRef.current = { top: rect.top, left: rect.left }
    const right = Math.max(EDGE, window.innerWidth - rect.right)
    const fitsBelow = window.innerHeight - rect.bottom >= MENU_HEIGHT_ALLOWANCE
    setPlacement(fitsBelow ? { right, top: rect.bottom + GAP } : { right, bottom: window.innerHeight - rect.top + GAP })
    startAtRef.current = startAt
    setOpen(true)
  }

  // While open: move focus into the menu, and close on a click elsewhere, on Escape, and if the page moves under it.
  useEffect(() => {
    if (!open) return
    const list = items()
    ;(startAtRef.current === 'last' ? list[list.length - 1] : list[0])?.focus({ preventScroll: true })

    const onPointerDown = (event: Event) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false)
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    const onResize = () => close(false)
    // Browsers deliver scroll events a frame late, so one can arrive just after the menu opens although the
    // scrolling happened before. Only close if the page has really moved the button out from under the menu.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      const now = triggerRef.current?.getBoundingClientRect()
      const was = openedAtRef.current
      if (!now || Math.abs(now.top - was.top) > 1 || Math.abs(now.left - was.left) > 1) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  // A menu that is open when its row disappears must not stay registered.
  useEffect(
    () => () => {
      if (activeMenu?.id === menuId) activeMenu = null
    },
    [menuId],
  )

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu(event.key === 'ArrowUp' ? 'last' : 'first')
    }
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items()
    const current = list.indexOf(document.activeElement as HTMLElement)
    const move = (index: number) => {
      event.preventDefault()
      list[(index + list.length) % list.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(current + 1)
    else if (event.key === 'ArrowUp') move(current - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(list.length - 1)
    else if (event.key === 'Tab') close() // focus goes back to the button, then the browser tabs on from there
  }

  const editPath = `/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}/edit`

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn row-menu__trigger"
        aria-label={`Actions for task ${task.id}: ${task.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu('first'))}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name="more" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Actions for task ${task.id}`}
            className="row-menu"
            style={placement}
            onKeyDown={onMenuKeyDown}
          >
            <Link role="menuitem" tabIndex={-1} className="row-menu__item" to={editPath} onClick={() => close()}>
              <Icon name="edit" />
              Edit task
            </Link>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="row-menu__item row-menu__item--danger"
              onClick={() => {
                close() // focus returns to the button first, so the confirmation dialog remembers it and gives it back
                onDelete()
              }}
            >
              <Icon name="trash" />
              Delete task
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
