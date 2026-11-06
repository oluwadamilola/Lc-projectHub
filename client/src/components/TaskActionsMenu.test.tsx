import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskActionsMenu } from './TaskActionsMenu'

const taskOne = { id: 'TASK-001', projectId: 'PRJ-001', title: 'Survey the site' }
const taskTwo = { id: 'TASK-002', projectId: 'PRJ-002', title: 'Order switches' }

function Address() {
  const location = useLocation()
  return <output aria-label="address">{location.pathname}</output>
}

function renderMenus(onDeleteOne = vi.fn(), onDeleteTwo = vi.fn()) {
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <tr>
            <td>
              <TaskActionsMenu task={taskOne} onDelete={onDeleteOne} />
            </td>
          </tr>
          <tr>
            <td>
              <TaskActionsMenu task={taskTwo} onDelete={onDeleteTwo} />
            </td>
          </tr>
        </tbody>
      </table>
      <Address />
    </MemoryRouter>,
  )
  return { onDeleteOne, onDeleteTwo }
}

const triggerOne = () => screen.getByRole('button', { name: 'Actions for task TASK-001: Survey the site' })
const triggerTwo = () => screen.getByRole('button', { name: 'Actions for task TASK-002: Order switches' })
const menus = () => screen.queryAllByRole('menu')
const items = () => screen.getAllByRole('menuitem')

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
})
afterEach(() => vi.restoreAllMocks())

describe('TaskActionsMenu: the button', () => {
  it('is a labelled "⋮" button that says which task it is for and starts closed', () => {
    renderMenus()
    expect(triggerOne().getAttribute('aria-haspopup')).toBe('menu')
    expect(triggerOne().getAttribute('aria-expanded')).toBe('false')
    expect(triggerOne().getAttribute('aria-controls')).toBeNull()
    expect(triggerOne().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true') // the icon is decoration; the label carries the meaning
    expect(menus()).toHaveLength(0)
  })

  it('has no visible text of its own: only the icon', () => {
    renderMenus()
    expect(triggerOne().textContent).toBe('')
  })
})

describe('TaskActionsMenu: opening and closing', () => {
  it('opens on click, listing Edit task and Delete task with an icon each', () => {
    renderMenus()
    fireEvent.click(triggerOne())

    const menu = screen.getByRole('menu', { name: 'Actions for task TASK-001' })
    expect(items().map((item) => item.textContent)).toEqual(['Edit task', 'Delete task'])
    for (const item of items()) expect(item.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(triggerOne().getAttribute('aria-expanded')).toBe('true')
    expect(triggerOne().getAttribute('aria-controls')).toBe(menu.id)
  })

  it('puts focus on the first action when it opens', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    expect(document.activeElement).toBe(items()[0])
  })

  it('closes when the button is clicked again, and focus stays on the button', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.click(triggerOne())
    expect(menus()).toHaveLength(0)
    expect(triggerOne().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(triggerOne())
  })

  it('is drawn in the page body, not inside the table, so the scrolling table cannot clip it', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    const menu = screen.getByRole('menu')
    expect(menu.closest('table')).toBeNull()
    expect(menu.parentElement).toBe(document.body)
    expect(menu.classList.contains('row-menu')).toBe(true) // position: fixed, see components.css
  })
})

describe('TaskActionsMenu: choosing an action', () => {
  it('Edit task goes to that task\'s edit page and closes the menu', () => {
    renderMenus()
    fireEvent.click(triggerTwo())
    const edit = screen.getByRole('menuitem', { name: 'Edit task' })
    expect(edit.getAttribute('href')).toBe('/projects/PRJ-002/tasks/TASK-002/edit')
    fireEvent.click(edit)
    expect(screen.getByLabelText('address').textContent).toBe('/projects/PRJ-002/tasks/TASK-002/edit')
    expect(menus()).toHaveLength(0)
  })

  it('Delete task asks the page to start its (existing) confirmation, once, and closes the menu', () => {
    const { onDeleteOne, onDeleteTwo } = renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    expect(onDeleteOne).toHaveBeenCalledTimes(1)
    expect(onDeleteTwo).not.toHaveBeenCalled()
    expect(menus()).toHaveLength(0)
  })

  it('gives focus back to the button before the confirmation opens, so it can return there afterwards', () => {
    let focusedWhenAsked: Element | null = null
    renderMenus(vi.fn(() => (focusedWhenAsked = document.activeElement)))
    fireEvent.click(triggerOne())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    expect(focusedWhenAsked).toBe(triggerOne())
  })

  it('marks Delete task as the destructive action and Edit task as ordinary', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    expect(screen.getByRole('menuitem', { name: 'Delete task' }).classList.contains('row-menu__item--danger')).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Edit task' }).classList.contains('row-menu__item--danger')).toBe(false)
  })

  it('does nothing until an action is chosen: opening the menu does not edit or delete anything', () => {
    const { onDeleteOne } = renderMenus()
    fireEvent.click(triggerOne())
    expect(onDeleteOne).not.toHaveBeenCalled()
    expect(screen.getByLabelText('address').textContent).toBe('/')
  })
})

describe('TaskActionsMenu: closing without choosing', () => {
  it('a click elsewhere closes it and does not steal focus', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.pointerDown(document.body)
    expect(menus()).toHaveLength(0)
    expect(triggerOne().getAttribute('aria-expanded')).toBe('false')
  })

  it('a click inside the menu, or on the button, is not "elsewhere"', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.pointerDown(screen.getByRole('menu'))
    expect(menus()).toHaveLength(1)
    fireEvent.pointerDown(triggerOne())
    expect(menus()).toHaveLength(1)
  })

  it('Escape closes it and returns focus to the button', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(menus()).toHaveLength(0)
    expect(document.activeElement).toBe(triggerOne())
  })

  it('Escape does nothing when no menu is open', () => {
    renderMenus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(menus()).toHaveLength(0)
  })

  it('scrolling that moves the button closes it, so the menu never floats away from its row', () => {
    renderMenus()
    let top = 100
    triggerOne().getBoundingClientRect = () => ({ top, bottom: top + 32, right: 900, left: 868, width: 32, height: 32, x: 868, y: top, toJSON: () => ({}) }) as DOMRect
    fireEvent.click(triggerOne())
    top = 60 // the page scrolled 40px
    fireEvent.scroll(document)
    expect(menus()).toHaveLength(0)
  })

  it('a late scroll event that did not move the button leaves the menu open', () => {
    renderMenus()
    triggerOne().getBoundingClientRect = () => ({ top: 100, bottom: 132, right: 900, left: 868, width: 32, height: 32, x: 868, y: 100, toJSON: () => ({}) }) as DOMRect
    fireEvent.click(triggerOne())
    fireEvent.scroll(document) // delivered a frame late, from scrolling that finished before the menu opened
    expect(menus()).toHaveLength(1)
  })

  it('resizing the window closes it', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.resize(window)
    expect(menus()).toHaveLength(0)
  })

  it('scrolling inside the menu itself does not close it', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.scroll(screen.getByRole('menu'))
    expect(menus()).toHaveLength(1)
  })

  it('Tab closes it and returns focus to the button, so the browser carries on from there', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
    expect(menus()).toHaveLength(0)
    expect(document.activeElement).toBe(triggerOne())
  })
})

describe('TaskActionsMenu: keyboard', () => {
  it('Down on the button opens it on the first action; Up opens it on the last', () => {
    renderMenus()
    fireEvent.keyDown(triggerOne(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items()[0])
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    fireEvent.keyDown(triggerOne(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items()[1])
  })

  it('Up and Down move between the actions and wrap around', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    const [edit, remove] = items()
    fireEvent.keyDown(edit, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(remove, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(edit)
    fireEvent.keyDown(edit, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(remove)
  })

  it('Home and End jump to the first and last action', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    const [edit, remove] = items()
    fireEvent.keyDown(edit, { key: 'End' })
    expect(document.activeElement).toBe(remove)
    fireEvent.keyDown(remove, { key: 'Home' })
    expect(document.activeElement).toBe(edit)
  })

  it('keeps the actions out of the Tab order (they are reached with the arrow keys)', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    for (const item of items()) expect(item.getAttribute('tabindex')).toBe('-1')
  })

  it('exposes the standard menu roles', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
    expect(items()[0].tagName).toBe('A') // a real link, so Edit works like any other link
    expect(items()[1].tagName).toBe('BUTTON')
  })
})

describe('TaskActionsMenu: only one open at a time', () => {
  it('opening a second menu with a mouse closes the first', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.pointerDown(triggerTwo())
    fireEvent.click(triggerTwo())
    expect(menus()).toHaveLength(1)
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions for task TASK-002')
    expect(triggerOne().getAttribute('aria-expanded')).toBe('false')
    expect(triggerTwo().getAttribute('aria-expanded')).toBe('true')
  })

  it('also holds when only a click arrives (for example from a screen reader)', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.click(triggerTwo()) // no pointer event first
    expect(menus()).toHaveLength(1)
    expect(triggerOne().getAttribute('aria-expanded')).toBe('false')
  })

  it('also holds when the second is opened from the keyboard', () => {
    renderMenus()
    fireEvent.keyDown(triggerOne(), { key: 'ArrowDown' })
    fireEvent.keyDown(triggerTwo(), { key: 'ArrowDown' })
    expect(menus()).toHaveLength(1)
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions for task TASK-002')
  })

  it('the first can be opened again afterwards', () => {
    renderMenus()
    fireEvent.click(triggerOne())
    fireEvent.click(triggerTwo())
    fireEvent.click(triggerOne())
    expect(menus()).toHaveLength(1)
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions for task TASK-001')
  })
})

describe('TaskActionsMenu: placement', () => {
  const rectAt = (top: number, bottom: number, right: number) =>
    ({ top, bottom, right, left: right - 32, width: 32, height: bottom - top, x: right - 32, y: top, toJSON: () => ({}) }) as DOMRect

  it('opens below the button, lined up with its right edge', () => {
    renderMenus()
    triggerOne().getBoundingClientRect = () => rectAt(100, 132, 900)
    fireEvent.click(triggerOne())
    const style = screen.getByRole('menu').style
    expect(style.top).toBe('136px') // 4px below the button
    expect(style.right).toBe('124px') // 1024 - 900
    expect(style.bottom).toBe('')
  })

  it('opens upwards instead when there is not enough room below (the last row of a long page)', () => {
    renderMenus()
    triggerOne().getBoundingClientRect = () => rectAt(700, 732, 900)
    fireEvent.click(triggerOne())
    const style = screen.getByRole('menu').style
    expect(style.bottom).toBe('72px') // 768 - 700 + 4
    expect(style.top).toBe('')
  })

  it('never sits closer than 8px to the screen edge (narrow phones)', () => {
    renderMenus()
    triggerOne().getBoundingClientRect = () => rectAt(100, 132, 1024)
    fireEvent.click(triggerOne())
    expect(screen.getByRole('menu').style.right).toBe('8px')
  })
})

describe('TaskActionsMenu: tidying up', () => {
  it('removes the open menu when its row goes away, and another menu still opens normally', () => {
    const { rerender } = render(
      <MemoryRouter>
        <TaskActionsMenu key={taskOne.id} task={taskOne} onDelete={vi.fn()} />
        <TaskActionsMenu key={taskTwo.id} task={taskTwo} onDelete={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /TASK-001/ }))
    rerender(
      <MemoryRouter>
        <TaskActionsMenu key={taskTwo.id} task={taskTwo} onDelete={vi.fn()} />
      </MemoryRouter>,
    )
    expect(menus()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /TASK-002/ }))
    expect(menus()).toHaveLength(1)
  })
})
