import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StatCard } from './StatCard'

const value = () => document.querySelector('.stat-card__value')?.textContent

describe('StatCard', () => {
  it('shows the value and hint when ready, and is not marked busy', () => {
    render(<StatCard label="Active projects" value={7} hint="12 projects in total" />)
    expect(value()).toBe('7')
    expect(screen.getByText('12 projects in total')).toBeTruthy()
    expect(document.querySelector('.stat-card')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a real zero as 0', () => {
    render(<StatCard label="Need attention" value={0} hint="At risk or delayed" />)
    expect(value()).toBe('0')
  })

  it('while loading shows a dash (never the value), announces the status and is marked busy', () => {
    render(<StatCard label="Tasks due this week" value={0} state="loading" hint="Loading task data…" />)
    expect(value()).toBe('—')
    expect(screen.getByRole('status').textContent).toBe('Loading task data…')
    expect(document.querySelector('.stat-card')?.getAttribute('aria-busy')).toBe('true')
  })

  it('on error shows a dash (never the value), an alert and a working retry', () => {
    const retry = vi.fn()
    render(<StatCard label="Tasks due this week" value={0} state="error" hint="Task data could not be loaded." onRetry={retry} />)
    expect(value()).toBe('—')
    expect(screen.getByRole('alert').textContent).toBe('Task data could not be loaded.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('offers no retry button when there is nothing to retry', () => {
    render(<StatCard label="x" value="" state="error" hint="Failed." />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('labels sample figures', () => {
    render(<StatCard label="Equipment deployed" value="126 / 160" hint="Items" sample />)
    expect(screen.getByText('Sample data')).toBeTruthy()
  })
})
