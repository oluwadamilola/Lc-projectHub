import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { ThemeToggle } from '../components/ThemeToggle'
import { installMatchMedia } from '../test/matchMedia'
import { ThemeProvider } from './ThemeProvider'
import { THEME_STORAGE_KEY } from './useTheme'

const applied = () => document.documentElement.dataset.theme
const renderToggle = () =>
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
const selected = () => screen.getByRole('radio', { checked: true }).getAttribute('aria-label')

describe('theme', () => {
  it('follows the system theme by default', () => {
    installMatchMedia(true)
    renderToggle()
    expect(applied()).toBe('dark')
    expect(selected()).toBe('System theme')
  })

  it('follows live changes of the system theme while "System" is selected', () => {
    const media = installMatchMedia(false)
    renderToggle()
    expect(applied()).toBe('light')
    act(() => media.change(true))
    expect(applied()).toBe('dark')
    act(() => media.change(false))
    expect(applied()).toBe('light')
  })

  it('applies a manual choice, saves it, and ignores the system afterwards', () => {
    const media = installMatchMedia(true)
    renderToggle()
    fireEvent.click(screen.getByRole('radio', { name: 'Light theme' }))
    expect(applied()).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    act(() => media.change(false))
    act(() => media.change(true))
    expect(applied()).toBe('light')
  })

  it('restores the saved choice after a refresh', () => {
    installMatchMedia(false)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    renderToggle()
    expect(applied()).toBe('dark')
    expect(selected()).toBe('Dark theme')
  })

  it('ignores an invalid saved value', () => {
    installMatchMedia(false)
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    renderToggle()
    expect(applied()).toBe('light')
    expect(selected()).toBe('System theme')
  })

  it('still works when storage is blocked', () => {
    installMatchMedia(false)
    const blocked = () => {
      throw new Error('blocked')
    }
    const proto = Storage.prototype
    const { getItem, setItem } = proto
    proto.getItem = blocked
    proto.setItem = blocked
    try {
      renderToggle()
      fireEvent.click(screen.getByRole('radio', { name: 'Dark theme' }))
      expect(applied()).toBe('dark')
    } finally {
      proto.getItem = getItem
      proto.setItem = setItem
    }
  })

  it('moves between options with the arrow keys', () => {
    installMatchMedia(false)
    renderToggle()
    const system = screen.getByRole('radio', { name: 'System theme' })
    fireEvent.keyDown(system, { key: 'ArrowRight' })
    expect(selected()).toBe('Light theme')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Light theme' }), { key: 'ArrowLeft' })
    expect(selected()).toBe('System theme')
    fireEvent.keyDown(system, { key: 'ArrowLeft' })
    expect(selected()).toBe('Dark theme')
  })
})
