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
  it('offers exactly two options: light and dark', () => {
    installMatchMedia(false)
    renderToggle()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'Light theme',
      'Dark theme',
    ])
  })

  it('starts light when the system prefers light and nothing is saved', () => {
    installMatchMedia(false)
    renderToggle()
    expect(applied()).toBe('light')
    expect(selected()).toBe('Light theme')
  })

  it('starts dark when the system prefers dark and nothing is saved', () => {
    installMatchMedia(true)
    renderToggle()
    expect(applied()).toBe('dark')
    expect(selected()).toBe('Dark theme')
  })

  it('switches to Light from a dark system and back, saving each choice', () => {
    installMatchMedia(true)
    renderToggle()
    fireEvent.click(screen.getByRole('radio', { name: 'Light theme' }))
    expect(applied()).toBe('light')
    expect(selected()).toBe('Light theme')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    fireEvent.click(screen.getByRole('radio', { name: 'Dark theme' }))
    expect(applied()).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('does not change by itself when the system theme changes later', () => {
    const media = installMatchMedia(true)
    renderToggle()
    fireEvent.click(screen.getByRole('radio', { name: 'Light theme' }))
    act(() => media.change(false))
    act(() => media.change(true))
    expect(applied()).toBe('light')
  })

  it('restores the saved choice after a refresh, over the system preference', () => {
    installMatchMedia(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderToggle()
    expect(applied()).toBe('light')
    expect(selected()).toBe('Light theme')
  })

  it.each(['system', 'purple', ''])('ignores an invalid or old saved value (%j) and uses the system preference', (saved) => {
    installMatchMedia(true)
    localStorage.setItem(THEME_STORAGE_KEY, saved)
    renderToggle()
    expect(applied()).toBe('dark')
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
      expect(applied()).toBe('light')
      fireEvent.click(screen.getByRole('radio', { name: 'Dark theme' }))
      expect(applied()).toBe('dark')
    } finally {
      proto.getItem = getItem
      proto.setItem = setItem
    }
  })

  it('moves between the two options with the arrow keys and wraps around', () => {
    installMatchMedia(false)
    renderToggle()
    const light = screen.getByRole('radio', { name: 'Light theme' })
    fireEvent.keyDown(light, { key: 'ArrowRight' })
    expect(selected()).toBe('Dark theme')
    expect(applied()).toBe('dark')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Dark theme' }), { key: 'ArrowRight' })
    expect(selected()).toBe('Light theme')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Light theme' }), { key: 'ArrowLeft' })
    expect(selected()).toBe('Dark theme')
  })

  it('keeps only the selected option in the tab order', () => {
    installMatchMedia(false)
    renderToggle()
    const tabbable = screen.getAllByRole('radio').filter((radio) => radio.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0].getAttribute('aria-label')).toBe('Light theme')
  })
})
