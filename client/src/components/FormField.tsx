import type { ReactNode } from 'react'
import { fieldId } from '../lib/fieldId'

export interface FieldRenderProps {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

interface FormFieldProps {
  name: string
  label: string
  error: string | undefined
  hint?: string
  wide?: boolean
  children: (props: FieldRenderProps) => ReactNode
}

/** Label, hint and error text wired to the control through aria-describedby. */
export function FormField({ name, label, error, hint, wide, children }: FormFieldProps) {
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
