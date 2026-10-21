import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_TEXT_LIMITS,
  type Project,
  type ProjectInput,
  type ProjectInputField,
} from '@lc-projecthub/shared'
import { useFormController } from '../hooks/useFormController'
import { isDirty, isFormField, validateForm, type FormValues } from '../lib/projectForm'
import { ErrorSummary } from './ErrorSummary'
import { FormField } from './FormField'
import { LeaveDialog } from './LeaveDialog'

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

export function ProjectForm({ initialValues, submitLabel, savingLabel, cancelTo, onSubmit, onSaved }: ProjectFormProps) {
  const [values, setValues] = useState<FormValues>(initialValues)

  const form = useFormController<ProjectInput, Project>({
    dirty: isDirty(values, initialValues),
    validate: () => validateForm(values),
    submit: onSubmit,
    onSaved,
    fieldProblemMessage: 'The project could not be saved. Check the highlighted fields and try again.',
    fallbackMessage: 'The project could not be saved. Please try again.',
  })
  const { errors, saving } = form

  function change(field: ProjectInputField) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      form.clearFieldError(field)
    }
  }

  return (
    <>
      <form className="card form-card" onSubmit={form.handleSubmit} noValidate aria-busy={saving}>
        <p className="form-note">All fields are required.</p>

        {form.hasProblems && (
          <ErrorSummary
            formError={form.formError}
            problems={form.problems}
            isField={isFormField}
            summaryRef={form.summaryRef}
          />
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

      {form.leaveBlocked && <LeaveDialog onStay={form.stay} onLeave={form.leave} stayButtonRef={form.stayButtonRef} />}
    </>
  )
}
