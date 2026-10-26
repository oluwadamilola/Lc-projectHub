import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { Project, ProjectInput } from '@lc-projecthub/shared'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { emptyFormValues, valuesFromProject, type FormValues } from '../lib/projectForm'
import { projectA } from '../test/fixtures'
import { ProjectForm } from './ProjectForm'

const saved: Project = { ...projectA, id: 'PRJ-113' }

interface Options {
  initialValues?: FormValues
  onSubmit?: (input: ProjectInput) => Promise<Project>
  onSaved?: (project: Project) => void
}

function renderForm({ initialValues = emptyFormValues(new Date(2026, 2, 5)), onSubmit, onSaved }: Options = {}) {
  const submit = vi.fn(onSubmit ?? (() => Promise.resolve(saved)))
  const done = vi.fn(onSaved ?? (() => {}))
  const router = createMemoryRouter(
    [
      {
        path: '/form',
        element: (
          <>
            <ProjectForm
              initialValues={initialValues}
              submitLabel="Create project"
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
const submitButton = () => screen.getByRole('button', { name: /Create project|Creating…/ }) as HTMLButtonElement

function fillValid() {
  fill('Project name', '  Foxtrot Wi-Fi ')
  fill('Description', 'Add access points.')
  fill('Location', 'Test Annexe')
  fill('Department', 'Infrastructure')
  fill('Project lead', 'Jamie Cole')
  fill('Progress (%)', '0')
  fill('Target completion date', '2026-08-01')
}

describe('ProjectForm fields', () => {
  it('labels every control and starts with sensible defaults', () => {
    renderForm()
    for (const label of [
      'Project name', 'Description', 'Location', 'Department', 'Project lead',
      'Priority', 'Status', 'Progress (%)', 'Start date', 'Target completion date',
    ]) {
      expect(field(label).required).toBe(true)
    }
    expect(field('Priority').value).toBe('Medium')
    expect(field('Status').value).toBe('Planning')
    expect(field('Progress (%)').value).toBe('0')
    expect(field('Start date').value).toBe('2026-03-05')
    expect(screen.getByText('All fields are required.')).toBeTruthy()
  })

  it('offers only the supported statuses and priorities', () => {
    renderForm()
    const options = (label: string) => within(field(label)).getAllByRole('option').map((o) => o.textContent)
    expect(options('Status')).toEqual(['On track', 'At risk', 'Delayed', 'Planning', 'Complete'])
    expect(options('Priority')).toEqual(['Low', 'Medium', 'High', 'Critical'])
  })

  it('loads existing values when editing', () => {
    renderForm({ initialValues: valuesFromProject(projectA) })
    expect(field('Project name').value).toBe('Alpha Network')
    expect(field('Progress (%)').value).toBe('60')
    expect(field('Target completion date').value).toBe('2026-03-30')
  })
})

describe('ProjectForm validation', () => {
  it('shows an error summary and field messages, and does not submit', () => {
    const { submit } = renderForm()
    fireEvent.click(submitButton())

    const summary = screen.getByRole('alert')
    expect(within(summary).getByText('There is a problem')).toBeTruthy()
    expect(within(summary).getByRole('link', { name: 'Enter the project name.' })).toBeTruthy()
    expect(within(summary).getByRole('link', { name: 'Enter the target completion date.' })).toBeTruthy()
    expect(document.activeElement).toBe(summary)
    expect(submit).not.toHaveBeenCalled()

    const name = field('Project name')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    const describedBy = name.getAttribute('aria-describedby')!
    expect(document.getElementById(describedBy)?.textContent).toContain('Enter the project name.')
    // A valid, untouched field is not marked invalid.
    expect(field('Priority').getAttribute('aria-invalid')).toBeNull()
  })

  it('links each summary message to its field', () => {
    renderForm()
    fireEvent.click(submitButton())
    fireEvent.click(within(screen.getByRole('alert')).getByRole('link', { name: 'Enter the location.' }))
    expect(document.activeElement).toBe(field('Location'))
  })

  it('clears a field message as soon as that field is edited', () => {
    renderForm()
    fireEvent.click(submitButton())
    expect(screen.getAllByText('Enter the project name.').length).toBeGreaterThan(0)
    fill('Project name', 'Something')
    expect(field('Project name').getAttribute('aria-invalid')).toBeNull()
    expect(within(screen.getByRole('alert')).queryByText('Enter the project name.')).toBeNull()
    // Other messages remain until fixed.
    expect(within(screen.getByRole('alert')).getByText('Enter the location.')).toBeTruthy()
  })

  it.each(['101', '-1', '2.5', ''])('rejects progress %j', (progress) => {
    const { submit } = renderForm()
    fillValid()
    fill('Progress (%)', progress)
    fireEvent.click(submitButton())
    expect(within(screen.getByRole('alert')).getByText('Enter the progress as a whole number from 0 to 100.')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects a target date before the start date', () => {
    const { submit } = renderForm()
    fillValid()
    fill('Start date', '2026-09-01')
    fill('Target completion date', '2026-08-01')
    fireEvent.click(submitButton())
    expect(
      within(screen.getByRole('alert')).getByText('The target completion date must be on or after the start date.'),
    ).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('requires a completed project to be 100%', () => {
    const { submit } = renderForm()
    fillValid()
    fill('Status', 'Complete')
    fireEvent.click(submitButton())
    expect(within(screen.getByRole('alert')).getByText('A completed project must be 100% complete.')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects over-long and blank text', () => {
    renderForm()
    fillValid()
    fill('Project lead', '   ')
    fireEvent.click(submitButton())
    expect(within(screen.getByRole('alert')).getByText('Enter the project lead.')).toBeTruthy()
  })
})

describe('ProjectForm saving', () => {
  it('submits trimmed, typed values and reports the saved project', async () => {
    const { submit, done } = renderForm()
    fillValid()
    fill('Progress (%)', '25')
    fill('Status', 'On track')
    fill('Priority', 'High')
    fireEvent.click(submitButton())

    await waitFor(() => expect(done).toHaveBeenCalledWith(saved))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({
      name: 'Foxtrot Wi-Fi',
      description: 'Add access points.',
      location: 'Test Annexe',
      department: 'Infrastructure',
      lead: 'Jamie Cole',
      priority: 'High',
      status: 'On track',
      progress: 25,
      startDate: '2026-03-05',
      dueDate: '2026-08-01',
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a saving state and ignores repeated submits while the request is in flight', async () => {
    let finish!: (project: Project) => void
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
    expect(field('Project name').matches(':disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Saving the project…')

    await act(async () => finish(saved))
    expect(done).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('shows server field errors beside the fields and keeps what the user typed', async () => {
    const { submit, done } = renderForm({
      onSubmit: () =>
        Promise.reject(
          new ApiRequestError('The request contains invalid values.', 400, 'VALIDATION_ERROR', [
            { field: 'lead', message: 'The project lead must be 100 characters or fewer.' },
            { field: 'dueDate', message: 'Enter a valid target completion date.' },
          ]),
        ),
    })
    fillValid()
    fireEvent.click(submitButton())

    const summary = await screen.findByRole('alert')
    expect(within(summary).getByText(/could not be saved/)).toBeTruthy()
    expect(within(summary).getByRole('link', { name: 'The project lead must be 100 characters or fewer.' })).toBeTruthy()
    expect(field('Project lead').getAttribute('aria-invalid')).toBe('true')
    expect(field('Target completion date').getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(summary))

    expect(field('Project name').value).toBe('  Foxtrot Wi-Fi ')
    expect(field('Location').value).toBe('Test Annexe')
    expect(done).not.toHaveBeenCalled()
    expect(submitButton().disabled).toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)
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
    expect(field('Description').value).toBe('Add access points.')
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().textContent).toBe('Create project')

    fireEvent.click(submitButton())
    await waitFor(() => expect(done).toHaveBeenCalledWith(saved))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('handles an unexpected non-API error without losing input', async () => {
    renderForm({ onSubmit: () => Promise.reject(new Error('boom')) })
    fillValid()
    fireEvent.click(submitButton())
    expect(await screen.findByText('The project could not be saved. Please try again.')).toBeTruthy()
    expect(field('Project name').value).toBe('  Foxtrot Wi-Fi ')
  })
})

describe('ProjectForm unsaved changes', () => {
  it('lets the user leave freely when nothing has changed', async () => {
    const { router } = renderForm()
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks before leaving with changes, and Stay keeps the page and the input', async () => {
    const { router } = renderForm()
    fill('Project name', 'Half written')
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    expect(router.state.location.pathname).toBe('/form')
    const stay = within(dialog).getByRole('button', { name: 'Stay on this page' })
    expect(document.activeElement).toBe(stay)

    fireEvent.click(stay)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/form')
    expect(field('Project name').value).toBe('Half written')
  })

  it('treats Escape in the prompt as Stay', async () => {
    const { router } = renderForm()
    fill('Project name', 'Half written')
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Stay on this page' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/form')
  })

  it('Leave without saving navigates away', async () => {
    const { router } = renderForm()
    fill('Project name', 'Half written')
    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Leave without saving' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
  })

  it('also guards the Cancel link', async () => {
    const { router } = renderForm()
    fill('Description', 'Something')
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/form')
  })

  it('does not ask again after a successful save, so navigating on is not blocked', async () => {
    const { router } = renderForm({ onSaved: (project) => void router.navigate(`/elsewhere?saved=${project.id}`) })
    fillValid()
    fireEvent.click(submitButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('warns when the browser tab is closed or reloaded with unsaved changes only', () => {
    renderForm()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fill('Project name', 'Half written')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})
