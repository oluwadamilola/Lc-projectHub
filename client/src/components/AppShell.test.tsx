import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { installMatchMedia } from '../test/matchMedia'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AppShell } from './AppShell'

function renderShell(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>Home page</p>} />
            <Route path="/projects" element={<p>Projects page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const sidebar = () => document.getElementById('app-sidebar')!
const main = () => document.querySelector('.main')!
const openButton = () => screen.getByRole('button', { name: 'Open menu' })

describe('AppShell mobile drawer', () => {
  it('starts closed with the page interactive', () => {
    renderShell()
    expect(sidebar().dataset.open).toBe('false')
    expect(openButton().getAttribute('aria-expanded')).toBe('false')
    expect(main().hasAttribute('inert')).toBe(false)
  })

  it('moves focus into the drawer and makes the page behind inert when opened', () => {
    renderShell()
    fireEvent.click(openButton())
    expect(sidebar().dataset.open).toBe('true')
    expect(openButton().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }))
    expect(main().hasAttribute('inert')).toBe(true)
    expect(screen.getByText('Skip to main content').hasAttribute('inert')).toBe(true)
  })

  it('closes on Escape and returns focus to the menu button', () => {
    renderShell()
    fireEvent.click(openButton())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sidebar().dataset.open).toBe('false')
    expect(main().hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(openButton())
  })

  it('closes with the Close button and with the backdrop', () => {
    renderShell()
    fireEvent.click(openButton())
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(sidebar().dataset.open).toBe('false')

    fireEvent.click(openButton())
    fireEvent.click(document.querySelector('.scrim')!)
    expect(sidebar().dataset.open).toBe('false')
  })

  it('navigates and closes when a link is chosen', () => {
    renderShell()
    fireEvent.click(openButton())
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }))
    expect(screen.getByText('Projects page')).toBeTruthy()
    expect(sidebar().dataset.open).toBe('false')
  })

  it('marks the current page and sets the document title', () => {
    renderShell('/projects')
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('aria-current')).toBe('page')
    expect(document.title).toBe('Projects | LC ProjectHub')
    // Only the real current page is marked, not the logo link to "/".
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('drops the drawer state if the window grows to desktop width', () => {
    const media = installMatchMedia(false)
    renderShell()
    fireEvent.click(openButton())
    expect(main().hasAttribute('inert')).toBe(true)
    act(() => media.change(true))
    expect(sidebar().dataset.open).toBe('false')
    expect(main().hasAttribute('inert')).toBe(false)
  })
})
