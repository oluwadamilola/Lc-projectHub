import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useBlocker } from 'react-router-dom'
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_TEXT_LIMITS,
  type Project,
  type ProjectInput,
  type ProjectInputField,
} from '@lc-projecthub/shared'
import { ApiRequestError } from '../api/http'
import {
  isDirty,
  isFormField,
  toFieldErrors,
  validateForm,
  type FieldErrors,
  type FormValues,
} from '../lib/projectForm'

interface ProjectFormProps {
  initialValues: FormValues
  submitLabel: string
  savingLabel: string
  /** Where Cancel goes. */
  cancelTo: string
  /** Sends the project to the API. Rejects with an ApiRequestError on failure. */
  onSubmit: (input: ProjectInput) => Promise<Project>
  /** Called once the save has succeeded (the page navigates from here). */
  onSaved: (project: Project) => void
}

interface FieldRenderProps {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

interface FormFieldProps {
  name: ProjectInputField
  label: string
  error: string | undefined
  hint?: string
  wide?: boolean
  children: (props: FieldRenderProps) => ReactNode
}

const fieldId = (name: string) => `field-${name}`

/** Label, hint and error text wired to the control through aria-describedby. */
function FormField({ name, label, error, hint, wide, children }: FormFieldProps) {
  const id = fieldId(name)
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field${wide ? ' field--wide' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          <span className="visually-hidden">Error: </span>
          {error}
        </p>
      )}
    </div>
  )
}

const GENERIC_FIELD_PROBLEM = 'The project could not be saved. Check the highlighted fields and try again.'

export function ProjectForm({ initialValues, submitLabel, savingLabel, cancelTo, onSubmit, onSaved }: ProjectFormProps) {
  const [values, setValues] = useState<FormValues>(initialValues)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [problemCount, setProblemCount] = useState(0)

  const summaryRef = useRef<HTMLDivElement>(null)
  const stayButtonRef = useRef<HTMLButtonElement>(null)
  // A ref, not state: two quick clicks must not both get through before React re-renders.
  const submittingRef = useRef(false)
  const savedRef = useRef(false)

  const dirty = isDirty(values, initialValues)

  // Ask before leaving with unsaved changes, for in-app navigation...
  const blocker = useBlocker(() => dirty && !savedRef.current)
  useEffect(() => {
    if (blocker.state === 'blocked') stayButtonRef.current?.focus()
  }, [blocker.state])

  // ...and for closing or reloading the tab.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      if (savedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Move focus to the problem summary each time a submit fails, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (problemCount > 0) summaryRef.current?.focus()
  }, [problemCount])

  function change(field: ProjectInputField) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      // Editing a field clears its own message; the next submit re-checks everything.
      setErrors((current) => {
        if (current[field] === undefined) return current
        const { [field]: _cleared, ...rest } = current
        void _cleared
        return rest
      })
    }
  }

  function showProblems(next: FieldErrors, message: string | null) {
    setErrors(next)
    setFormError(message)
    setProblemCount((count) => count + 1)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const result = validateForm(values)
    if (!result.ok) {
      showProblems(toFieldErrors(result.errors), null)
      return
    }

    submittingRef.current = true
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const project = await onSubmit(result.input)
      savedRef.current = true
      onSaved(project)
    } catch (error) {
      // Values stay exactly as the user typed them.
      if (error instanceof ApiRequestError && error.details.length > 0) {
        showProblems(toFieldErrors(error.details), GENERIC_FIELD_PROBLEM)
      } else {
        const message = error instanceof ApiRequestError ? error.message : 'The project could not be saved. Please try again.'
        showProblems({}, message)
      }
      submittingRef.current = false
      setSaving(false)
    }
  }

  function focusField(field: string) {
    document.getElementById(fieldId(field))?.focus()
  }

  const fieldProblems = Object.entries(errors).filter((entry): entry is [string, string] => entry[1] !== undefined)
  const hasProblems = fieldProblems.length > 0 || formError !== null

  return (
    <>
      <form className="card form-card" onSubmit={handleSubmit} noValidate aria-busy={saving}>
        <p className="form-note">All fields are required.</p>

        {hasProblems && (
          <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <h2>There is a problem</h2>
            {formError && <p>{formError}</p>}
            {fieldProblems.length > 0 && (
              <ul>
                {fieldProblems.map(([field, message]) => (
                  <li key={field}>
                    {isFormField(field) ? (
                      <a
                        href={`#${fieldId(field)}`}
                        onClick={(event) => {
                          event.preventDefault()
                          focusField(field)
                        }}
                      >
                        {message}
                      </a>
                    ) : (
                      message
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <fieldset className="form-grid" disabled={saving}>
          <legend className="visually-hidden">Project details</legend>

          <FormField name="name" label="Project name" error={errors.name} wide>
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                required
                maxLength={PROJECT_TEXT_LIMITS.name}
                autoComplete="off"
                value={values.name}
                onChange={change('name')}
              />
            )}
          </FormField>

          <FormField
            name="description"
            label="Description"
            error={errors.description}
            hint={`What the project is for. Up to ${PROJECT_TEXT_LIMITS.description.toLocaleString('en-GB')} characters.`}
            wide
          >
            {(props) => (
              <textarea
                {...props}
                className="input input--area"
                required
                rows={4}
                maxLength={PROJECT_TEXT_LIMITS.description}
                value={values.description}
                onChange={change('description')}
              />
            )}
          </FormField>

          <FormField name="location" label="Location" error={errors.location}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                required
                maxLength={PROJECT_TEXT_LIMITS.location}
                autoComplete="off"
                value={values.location}
                onChange={change('location')}
              />
            )}
          </FormField>

          <FormField name="department" label="Department" error={errors.department}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                required
                maxLength={PROJECT_TEXT_LIMITS.department}
                autoComplete="off"
                value={values.department}
                onChange={change('department')}
              />
            )}
          </FormField>

          <FormField name="lead" label="Project lead" error={errors.lead} wide>
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                required
                maxLength={PROJECT_TEXT_LIMITS.lead}
                autoComplete="off"
                value={values.lead}
                onChange={change('lead')}
              />
            )}
          </FormField>

          <FormField name="priority" label="Priority" error={errors.priority}>
            {(props) => (
              <select {...props} className="input" required value={values.priority} onChange={change('priority')}>
                {PROJECT_PRIORITIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField name="status" label="Status" error={errors.status}>
            {(props) => (
              <select {...props} className="input" required value={values.status} onChange={change('status')}>
                {PROJECT_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField
            name="progress"
            label="Progress (%)"
            error={errors.progress}
            hint="A whole number from 0 to 100. A completed project must be 100."
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="number"
                required
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={values.progress}
                onChange={change('progress')}
              />
            )}
          </FormField>

          <FormField name="startDate" label="Start date" error={errors.startDate}>
            {(props) => (
              <input {...props} className="input" type="date" required value={values.startDate} onChange={change('startDate')} />
            )}
          </FormField>

          <FormField name="dueDate" label="Target completion date" error={errors.dueDate}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="date"
                required
                min={values.startDate || undefined}
                value={values.dueDate}
                onChange={change('dueDate')}
              />
            )}
          </FormField>
        </fieldset>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? savingLabel : submitLabel}
          </button>
          <Link className="btn" to={cancelTo}>
            Cancel
          </Link>
          <p className="visually-hidden" role="status">
            {saving ? 'Saving the project…' : ''}
          </p>
        </div>
      </form>

      {blocker.state === 'blocked' && (
        <div
          className="leave-dialog card"
          role="alertdialog"
          aria-labelledby="leave-title"
          aria-describedby="leave-text"
          onKeyDown={(event) => {
            // Escape means "never mind": stay on the page.
            if (event.key === 'Escape') blocker.reset()
          }}
        >
          <h2 id="leave-title">Leave without saving?</h2>
          <p id="leave-text">You have unsaved changes. If you leave this page they will be lost.</p>
          <div className="form-actions">
            <button type="button" ref={stayButtonRef} className="btn btn--primary" onClick={() => blocker.reset()}>
              Stay on this page
            </button>
            <button type="button" className="btn" onClick={() => blocker.proceed()}>
              Leave without saving
            </button>
          </div>
        </div>
      )}
    </>
  )
}
