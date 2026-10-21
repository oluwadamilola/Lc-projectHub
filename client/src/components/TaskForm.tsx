import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TEXT_LIMITS,
  type Task,
  type TaskInput,
  type TaskInputField,
  type Technician,
} from '@lc-projecthub/shared'
import { useFormController } from '../hooks/useFormController'
import { isTaskFormDirty, isTaskFormField, validateTaskForm, type TaskFormValues } from '../lib/taskForm'
import { ErrorSummary } from './ErrorSummary'
import { FormField } from './FormField'
import { LeaveDialog } from './LeaveDialog'

interface TaskFormProps {
  initialValues: TaskFormValues
  technicians: Technician[]
  submitLabel: string
  savingLabel: string
  /** Where Cancel goes. */
  cancelTo: string
  /** Sends the task to the API. Rejects with an ApiRequestError on failure. */
  onSubmit: (input: TaskInput) => Promise<Task>
  /** Called once the save has succeeded (the page navigates from here). */
  onSaved: (task: Task) => void
}

export function TaskForm({
  initialValues,
  technicians,
  submitLabel,
  savingLabel,
  cancelTo,
  onSubmit,
  onSaved,
}: TaskFormProps) {
  const [values, setValues] = useState<TaskFormValues>(initialValues)

  const form = useFormController<TaskInput, Task>({
    dirty: isTaskFormDirty(values, initialValues),
    validate: () => validateTaskForm(values),
    submit: onSubmit,
    onSaved,
    fieldProblemMessage: 'The task could not be saved. Check the highlighted fields and try again.',
    fallbackMessage: 'The task could not be saved. Please try again.',
  })
  const { errors, saving } = form

  function change(field: TaskInputField) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }))
      form.clearFieldError(field)
    }
  }

  // A task may still point at a technician who is no longer in the list; keep it selectable rather than silently clearing it.
  const knownAssignee = technicians.some((technician) => technician.id === values.assigneeId)

  return (
    <>
      <form className="card form-card" onSubmit={form.handleSubmit} noValidate aria-busy={saving}>
        <p className="form-note">Title, status, priority and both dates are required. Description and technician are optional.</p>

        {form.hasProblems && (
          <ErrorSummary
            formError={form.formError}
            problems={form.problems}
            isField={isTaskFormField}
            summaryRef={form.summaryRef}
          />
        )}

        <fieldset className="form-grid" disabled={saving}>
          <legend className="visually-hidden">Task details</legend>

          <FormField name="title" label="Task title" error={errors.title} wide>
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                required
                maxLength={TASK_TEXT_LIMITS.title}
                autoComplete="off"
                value={values.title}
                onChange={change('title')}
              />
            )}
          </FormField>

          <FormField
            name="description"
            label="Description (optional)"
            error={errors.description}
            hint={`Up to ${TASK_TEXT_LIMITS.description.toLocaleString('en-GB')} characters.`}
            wide
          >
            {(props) => (
              <textarea
                {...props}
                className="input input--area"
                rows={4}
                maxLength={TASK_TEXT_LIMITS.description}
                value={values.description}
                onChange={change('description')}
              />
            )}
          </FormField>

          <FormField name="status" label="Status" error={errors.status}>
            {(props) => (
              <select {...props} className="input" required value={values.status} onChange={change('status')}>
                {TASK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField name="priority" label="Priority" error={errors.priority}>
            {(props) => (
              <select {...props} className="input" required value={values.priority} onChange={change('priority')}>
                {TASK_PRIORITIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField name="assigneeId" label="Technician (optional)" error={errors.assigneeId} wide>
            {(props) => (
              <select {...props} className="input" value={values.assigneeId} onChange={change('assigneeId')}>
                <option value="">Unassigned</option>
                {technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name} ({technician.team})
                  </option>
                ))}
                {values.assigneeId !== '' && !knownAssignee && (
                  <option value={values.assigneeId}>{values.assigneeId} (not in the list)</option>
                )}
              </select>
            )}
          </FormField>

          <FormField name="startDate" label="Start date" error={errors.startDate}>
            {(props) => (
              <input {...props} className="input" type="date" required value={values.startDate} onChange={change('startDate')} />
            )}
          </FormField>

          <FormField name="dueDate" label="Due date" error={errors.dueDate}>
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
            {saving ? 'Saving the task…' : ''}
          </p>
        </div>
      </form>

      {form.leaveBlocked && <LeaveDialog onStay={form.stay} onLeave={form.leave} stayButtonRef={form.stayButtonRef} />}
    </>
  )
}
