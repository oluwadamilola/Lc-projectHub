import type { Ref } from 'react'
import { fieldId } from '../lib/fieldId'

interface ErrorSummaryProps {
  /** A message about the form as a whole (for example a failed save). */
  formError: string | null
  /** Field name and message pairs. */
  problems: [field: string, message: string][]
  /** Whether a field name matches a control on the form, so its message can link to it. */
  isField: (field: string) => boolean
  summaryRef: Ref<HTMLDivElement>
}

/** Lists everything wrong with the form. It takes focus after a failed submit; each message jumps to its field. */
export function ErrorSummary({ formError, problems, isField, summaryRef }: ErrorSummaryProps) {
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
      <h2>There is a problem</h2>
      {formError && <p>{formError}</p>}
      {problems.length > 0 && (
        <ul>
          {problems.map(([field, message]) => (
            <li key={field}>
              {isField(field) ? (
                <a
                  href={`#${fieldId(field)}`}
                  onClick={(event) => {
                    event.preventDefault()
                    document.getElementById(fieldId(field))?.focus()
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
  )
}
