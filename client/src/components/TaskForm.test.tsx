import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { Task, TaskInput } from '@lc-projecthub/shared'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { emptyTaskFormValues, valuesFromTask, type TaskFormValues } from '../lib/taskForm'
import { taskA, technicians } from '../test/fixtures'
import { TaskForm } from './TaskForm'

const saved: Task = { ...taskA, id: 'TASK-050' }

interface Options {
  initialValues?: TaskFormValues
  onSubmit?: (input: TaskInput) => Promise<Task>
  onSaved?: (task: Task) => void
}

function renderForm({ initialValues = emptyTaskFormValues(new Date(2026, 2, 5)), onSubmit, onSaved }: Options = {}) {
  const submit = vi.fn(onSubmit ?? (() => Promise.resolve(saved)))
  const done = vi.fn(onSaved ?? (() => {}))
  const router = createMemoryRouter(
    [
      {
        path: '/form',
        element: (
          <>
            <TaskForm
              initialValues={initialValues}
              technicians={technicians}
              submitLabel="Create task"
              savingLabel="Creating…"
              cancelTo="/cancelled"
              onSubmit={submit}
              onSaved={done}
            />
            <Link to="/elsewhere">Go elsewhere</Link>
          </>
        ),
      },
      { path: '/elsewhere', element: <p>Elsewhere page</p> },
      { path: '/cancelled', element: <p>Cancelled page</p> },
    ],
    { initialEntries: ['/form'] },
  )
  render(<RouterProvider router={router} />)
  return { submit, done, router }
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const fill = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const submitButton = () => screen.getByRole('button', { name: /Create task|Creating…/ }) as HTMLButtonElement

function fillValid() {
  fill('Task title', '  Label the cables ')
  fill('Description (optional)', 'Both ends of every run.')
  fill('Due date', '2026-03-20')
}

describe('TaskForm fields', () => {
  it('labels every control and starts with sensible defaults', () => {
    renderForm()
    expect(field('Task title').required).toBe(true)
    expect(field('Status').required).toBe(true)
    expect(field('Priority').required).toBe(true)
    expect(field('Start date').required).toBe(true)
    expect(field('Due date').required).toBe(true)
    expect(field('Description (optional)').required).toBe(false)
    expect(field('Technician (optional)').required).toBe(false)
    expect(field('Status').value).toBe('To do')
    expect(field('Priority').value).toBe('Medium')
    expect(field('Technician (optional)').value).toBe('')
    expect(field('Start date').value).toBe('2026-03-05')
  })

  it('offers only task statuses and the fictional technicians, plus Unassigned', () => {
    renderForm()
    const options = (label: string) => within(field(label)).getAllByRole('option').map((o) => o.textContent)
    expect(options('Status')).toEqual(['To do', 'In progress', 'Blocked', 'Done'])
    expect(options('Priority')).toEqual(['Low', 'Medium', 'High', 'Critical'])
    expect(options('Technician (optional)')).toEqual([
      'Unassigned',
      'Test Technician One (Test Team A)',
      'Test Technician Two (Test Team B)',
    ])
  })

  it('loads existing values when editing', () => {
    renderForm({ initialValues: valuesFromTask(taskA) })
    expect(field('Task title').value).toBe('Survey the site')
    expect(field('Technician (optional)').value).toBe('TECH-001')
    expect(field('Due date').value).toBe('2099-01-12')
  })

  it('keeps a technician who is no longer in the list selectable instead of silently clearing it', () => {
    renderForm({ initialValues: { ...valuesFromTask(taskA), assigneeId: 'TECH-099' } })
    expect(field('Technician (optional)').value).toBe('TECH-099')
    expect(within(field('Technician (optional)')).getByRole('option', { name: 'TECH-099 (not in the list)' })).toBeTruthy()
  })
})

describe('TaskForm validation', () => {
  it('shows an error summary and field messages, and does not submit', () => {
    const { submit } = renderForm()
    fireEvent.click(submitButton())

    const summary = screen.getByRole('alert')
    expect(within(summary).getByRole('link', { name: 'Enter the task title.' })).toBeTruthy()
    expect(within(summary).getByRole('link', { name: 'Enter the due date.' })).toBeTruthy()
    expect(document.activeElement).toBe(summary)
    expect(submit).not.toHaveBeenCalled()

    const title = field('Task title')
    expect(title.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(title.getAttribute('aria-describedby')!)?.textContent).toContain('Enter the task title.')
    // Optional fields are never flagged.
    expect(field('Description (optional)').getAttribute('aria-invalid')).toBeNull()
    expect(field('Technician (optional)').getAttribute('aria-invalid')).toBeNull()
  })

  it('links summary messages to their fields and clears a message when its field is edited', () => {
    renderForm()
    fireEvent.click(submitButton())
    fireEvent.click(within(screen.getByRole('alert')).getByRole('link', { name: 'Enter the due date.' }))
    expect(document.activeElement).toBe(field('Due date'))
    fill('Task title', 'Something')
    expect(field('Task title').getAttribute('aria-invalid')).toBeNull()
    expect(within(screen.getByRole('alert')).queryByText('Enter the task title.')).toBeNull()
    expect(within(screen.getByRole('alert')).getByText('Enter the due date.')).toBeTruthy()
  })

  it('rejects a due date before the start date', () => {
    const { submit } = renderForm()
    fillValid()
    fill('Start date', '2026-04-01')
    fireEvent.click(submitButton())
    expect(within(screen.getByRole('alert')).getByText('The due date must be on or after the start date.')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects an over-long title', () => {
    renderForm()
    fillValid()
    // maxLength stops typing past 120, but pasted or programmatic values can still exceed it.
    fill('Task title', 'x'.repeat(121))
    fireEvent.click(submitButton())
    expect(within(screen.getByRole('alert')).getByText('The task title must be 120 characters or fewer.')).toBeTruthy()
  })
})

describe('TaskForm saving', () => {
  it('submits trimmed, typed values (an empty technician becomes null) and reports the saved task', async () => {
    const { submit, done } = renderForm()
    fillValid()
    fill('Status', 'In progress')
    fill('Priority', 'High')
    fireEvent.click(submitButton())

    await waitFor(() => expect(done).toHaveBeenCalledWith(saved))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({
      title: 'Label the cables',
      description: 'Both ends of every run.',
      status: 'In progress',
      priority: 'High',
      assigneeId: null,
      startDate: '2026-03-05',
      dueDate: '2026-03-20',
    })
  })

  it('sends the chosen technician', async () => {
    const { submit } = renderForm()
    fillValid()
    fill('Technician (optional)', 'TECH-002')
    fireEvent.click(submitButton())
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({ assigneeId: 'TECH-002' })
  })

  it('shows a saving state and ignores repeated submits while the request is in flight', async () => {
    let finish!: (task: Task) => void
    const { submit, done } = renderForm({ onSubmit: () => new Promise((resolve) => (finish = resolve)) })
    fillValid()

    const form = submitButton().closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.click(submitButton())

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submitButton().disabled).toBe(true)
    expect(submitButton().textContent).toBe('Creating…')
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(field('Task title').matches(':disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Saving the task…')

    await act(async () => finish(saved))
    expect(done).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('shows server field errors beside the fields and keeps what the user typed', async () => {
    const { done } = renderForm({
      onSubmit: () =>
        Promise.reject(
          new ApiRequestError('The request contains invalid values.', 400, 'VALIDATION_ERROR', [
            { field: 'assigneeId', message: 'That technician was not found. Choose one from the list.' },
          ]),
        ),
    })
    fillValid()
    fill('Technician (optional)', 'TECH-001')
    fireEvent.click(submitButton())

    const summary = await screen.findByRole('alert')
    expect(within(summary).getByText(/could not be saved/)).toBeTruthy()
    expect(within(summary).getByRole('link', { name: 'That technician was not found. Choose one from the list.' })).toBeTruthy()
    expect(field('Technician (optional)').getAttribute('aria-invalid')).toBe('true')
    expect(field('Task title').value).toBe('  Label the cables ')
    expect(field('Technician (optional)').value).toBe('TECH-001')
    expect(done).not.toHaveBeenCalled()
    expect(submitButton().disabled).toBe(false)
  })

  it('shows a useful message for a failed save, keeps the input, and allows trying again', async () => {
    let attempt = 0
    const { submit, done } = renderForm({
      onSubmit: () =>
        ++attempt === 1
          ? Promise.reject(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
          : Promise.resolve(saved),
    })
    fillValid()
    fireEvent.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The server could not be reached. Check your connection and try again.')).toBeTruthy()
    expect(field('Description (optional)').value).toBe('Both ends of every run.')

    fireEvent.click(submitButton())
    await waitFor(() => expect(done).toHaveBeenCalledWith(saved))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('handles an unexpected non-API error without losing input', async () => {
    renderForm({ onSubmit: () => Promise.reject(new Error('boom')) })
    fillValid()
    fireEvent.click(submitButton())
    expect(await screen.findByText('The task could not be saved. Please try again.')).toBeTruthy()
    expect(field('Task title').value).toBe('  Label the cables ')
  })
})

describe('TaskForm unsaved changes', () => {
  it('lets the user leave freely when nothing has changed', async () => {
    const { router } = renderForm()
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
  })

  it('asks before leaving with changes; Escape and Stay keep the input, Leave navigates', async () => {
    const { router } = renderForm()
    fill('Task title', 'Half written')
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    expect(router.state.location.pathname).toBe('/form')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Stay on this page' }))

    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Stay on this page' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(field('Task title').value).toBe('Half written')

    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Leave without saving' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/cancelled'))
  })

  it('does not ask again after a successful save', async () => {
    const { router } = renderForm({ onSaved: () => void router.navigate('/elsewhere') })
    fillValid()
    fireEvent.click(submitButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('warns when the tab is closed with unsaved changes only', () => {
    renderForm()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    fill('Task title', 'Half written')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})
