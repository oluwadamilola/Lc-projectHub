import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useBlocker } from 'react-router-dom'
import type { ApiErrorDetail } from '@lc-projecthub/shared'
import { ApiRequestError } from '../api/http'
import { toFieldErrors, type FieldErrors } from '../lib/projectForm'

export type Validation<TInput> = { ok: true; input: TInput } | { ok: false; errors: ApiErrorDetail[] }

interface Options<TInput, TSaved> {
  /** True while the values differ from where the form started. */
  dirty: boolean
  /** Checks the current values in the browser. */
  validate: () => Validation<TInput>
  /** Sends the values to the API. Rejects with an ApiRequestError on failure. */
  submit: (input: TInput) => Promise<TSaved>
  /** Called once the save has succeeded (the page navigates from here). */
  onSaved: (saved: TSaved) => void
  /** Shown above the list when the server rejects individual fields. */
  fieldProblemMessage: string
  /** Shown when something unexpected (not an API error) goes wrong. */
  fallbackMessage: string
}

/**
 * Everything a create/edit form needs besides its fields: validation, a guard against double
 * submission, saving / failure state that keeps what the user typed, focus management for the
 * error summary, and the "unsaved changes" prompts for in-app navigation and closing the tab.
 */
export function useFormController<TInput, TSaved>({
  dirty,
  validate,
  submit,
  onSaved,
  fieldProblemMessage,
  fallbackMessage,
}: Options<TInput, TSaved>) {
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [problemCount, setProblemCount] = useState(0)

  const summaryRef = useRef<HTMLDivElement>(null)
  const stayButtonRef = useRef<HTMLButtonElement>(null)
  // A ref, not state: two quick clicks must not both get through before React re-renders.
  const submittingRef = useRef(false)
  const savedRef = useRef(false)

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

  function showProblems(next: FieldErrors, message: string | null) {
    setErrors(next)
    setFormError(message)
    setProblemCount((count) => count + 1)
  }

  /** Editing a field clears its own message; the next submit re-checks everything. */
  function clearFieldError(field: string) {
    setErrors((current) => {
      if (current[field] === undefined) return current
      const { [field]: _cleared, ...rest } = current
      void _cleared
      return rest
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const result = validate()
    if (!result.ok) {
      showProblems(toFieldErrors(result.errors), null)
      return
    }

    submittingRef.current = true
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const saved = await submit(result.input)
      savedRef.current = true
      onSaved(saved)
    } catch (error) {
      // Values stay exactly as the user typed them.
      if (error instanceof ApiRequestError && error.details.length > 0) {
        showProblems(toFieldErrors(error.details), fieldProblemMessage)
      } else {
        showProblems({}, error instanceof ApiRequestError ? error.message : fallbackMessage)
      }
      submittingRef.current = false
      setSaving(false)
    }
  }

  const leaveBlocked = blocker.state === 'blocked'
  /** The blocker only offers reset/proceed while it is actually blocking, so these are safe to call any time. */
  const stay = () => {
    if (blocker.state === 'blocked') blocker.reset()
  }
  const leave = () => {
    if (blocker.state === 'blocked') blocker.proceed()
  }

  const problems = Object.entries(errors).filter((entry): entry is [string, string] => entry[1] !== undefined)

  return {
    errors,
    formError,
    problems,
    hasProblems: problems.length > 0 || formError !== null,
    saving,
    summaryRef,
    stayButtonRef,
    leaveBlocked,
    stay,
    leave,
    clearFieldError,
    handleSubmit,
  }
}
