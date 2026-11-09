import { useState } from 'react'
import type { CheckDefinition, CheckResult, CheckResultCondition, EquipmentLine, ResultCondition } from '@lc-projecthub/shared'
import { NOTE_MAX_LENGTH } from '@lc-projecthub/shared'
import type { LineSave } from '../hooks/useChecklistAutosave'
import { formatWhen } from '../lib/audit'
import { CONDITION_CHOICES, checksApply, conditionNeedsNote, itemTitle, type LineDraft } from '../lib/inspection'
import { ConditionBadge, ReviewBadge } from './AuditBadges'

interface InspectionItemProps {
  line: EquipmentLine
  draft: LineDraft
  save: LineSave | undefined
  disabled: boolean
  onChange: (patch: Partial<LineDraft>, options: { immediate: boolean }) => void
  onRetry: () => void
}

const CONDITION_CLASS: Record<ResultCondition, string> = {
  Working: 'success',
  'Not working': 'danger',
  'Needs replacement': 'warning',
  Missing: 'danger',
  'Not applicable': 'neutral',
  'Not checked': 'neutral',
}

function SaveNote({ save, onRetry }: { save: LineSave | undefined; onRetry: () => void }) {
  if (!save) return null
  if (save.state === 'error') {
    return (
      <p className="check-item__save check-item__save--error" role="alert">
        Not saved: {save.message}{' '}
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Try again
        </button>
      </p>
    )
  }
  return (
    <p className="check-item__save" aria-live="polite">
      {save.state === 'saving' ? 'Saving…' : 'Saved'}
    </p>
  )
}

/** One answer to an extra check, such as firmware: up to date, needs update, or not applicable. */
function CheckQuestion({
  definition,
  answer,
  itemId,
  disabled,
  onAnswer,
}: {
  definition: CheckDefinition
  answer: CheckResult
  itemId: string
  disabled: boolean
  onAnswer: (next: CheckResult, options: { immediate: boolean }) => void
}) {
  const options: { value: CheckResultCondition; label: string; tone: string }[] = [
    { value: 'Working', label: definition.okLabel, tone: 'success' },
    { value: 'Not working', label: definition.notOkLabel, tone: 'danger' },
    { value: 'Not applicable', label: 'Not applicable', tone: 'neutral' },
  ]
  const name = `check-${itemId}-${definition.id}`
  const noteId = `${name}-note`
  const needsNote = answer.condition === 'Not working'
  return (
    <fieldset className="check-item__check" disabled={disabled}>
      <legend>{definition.label}</legend>
      <div className="choices">
        {options.map((option) => (
          <label key={option.value} className={`choice choice--${option.tone}`}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={answer.condition === option.value}
              onChange={() => onAnswer({ ...answer, condition: option.value }, { immediate: true })}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {needsNote && (
        <div className="field">
          <label className="field__label" htmlFor={noteId}>
            Note about the {definition.label.toLowerCase()} check (required)
          </label>
          <textarea
            id={noteId}
            className="input input--area input--note"
            value={answer.note}
            maxLength={NOTE_MAX_LENGTH + 100}
            aria-invalid={answer.note.trim() === '' ? true : undefined}
            onChange={(event) => onAnswer({ ...answer, note: event.target.value }, { immediate: false })}
          />
        </div>
      )}
    </fieldset>
  )
}

/**
 * One item of equipment to check: what it is, what it was last time, and large controls to record its condition.
 * Everything entered is saved as it is entered (see useChecklistAutosave); nothing here talks to the server.
 */
export function InspectionItem({ line, draft, save, disabled, onChange, onRetry }: InspectionItemProps) {
  const title = itemTitle(line)
  const [noteOpen, setNoteOpen] = useState(false)
  const required = conditionNeedsNote(draft.condition)
  const showNote = required || noteOpen || draft.note !== ''
  const noteId = `note-${line.id}`
  const identifiers = [line.assetTag && `Asset tag ${line.assetTag}`, line.serialNumber && `Serial ${line.serialNumber}`].filter(Boolean).join(' · ')
  const previous = line.previous
  const noteMissing = required && draft.note.trim() === ''

  const updateCheck = (next: CheckResult, options: { immediate: boolean }) =>
    onChange({ checks: draft.checks.map((check) => (check.checkId === next.checkId ? next : check)) }, options)

  return (
    <li className={`check-item${draft.condition !== 'Not checked' ? ' check-item--answered' : ''}`} id={`item-${line.id}`}>
      <div className="check-item__head">
        <div>
          <h3 className="check-item__title" tabIndex={-1} id={`item-${line.id}-title`}>
            {title} <ReviewBadge status={line.reviewStatus} />
          </h3>
          {identifiers && <p className="check-item__meta">{identifiers}</p>}
          {line.source === 'Found during inspection' && <p className="check-item__meta">Found during an inspection</p>}
        </div>
        <div className="check-item__previous">
          {previous ? (
            <>
              <span className="check-item__previous-label">Last time</span>
              <ConditionBadge condition={previous.condition} />
              <span className="check-item__meta">
                {[previous.cycleName, formatWhen(previous.checkedAt)].filter(Boolean).join(' · ')}
              </span>
              {previous.note && <span className="check-item__meta">“{previous.note}”</span>}
            </>
          ) : (
            <span className="check-item__meta">No earlier inspection</span>
          )}
        </div>
      </div>

      <fieldset className="check-item__condition" disabled={disabled}>
        <legend className="visually-hidden">Condition of {title}</legend>
        <div className="choices">
          {CONDITION_CHOICES.map((condition) => (
            <label key={condition} className={`choice choice--${CONDITION_CLASS[condition]}`}>
              <input
                type="radio"
                name={`condition-${line.id}`}
                value={condition}
                checked={draft.condition === condition}
                onChange={() => onChange({ condition }, { immediate: true })}
              />
              <span>{condition}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {showNote ? (
        <div className="field">
          <label className="field__label" htmlFor={noteId}>
            {required ? `Note (required: say what is wrong with the ${title.toLowerCase()})` : 'Note (optional)'}
          </label>
          <textarea
            id={noteId}
            className="input input--area input--note"
            value={draft.note}
            disabled={disabled}
            maxLength={NOTE_MAX_LENGTH + 100}
            aria-invalid={noteMissing ? true : undefined}
            aria-describedby={noteMissing ? `${noteId}-hint` : undefined}
            onChange={(event) => onChange({ note: event.target.value }, { immediate: false })}
          />
          {noteMissing && (
            <p className="field__hint" id={`${noteId}-hint`}>
              A note is needed before the inspection can be completed.
            </p>
          )}
        </div>
      ) : (
        <button type="button" className="btn btn--small check-item__add-note" disabled={disabled} onClick={() => setNoteOpen(true)}>
          Add a note
        </button>
      )}

      {checksApply(draft.condition) &&
        line.checks.map((definition) => {
          const answer = draft.checks.find((check) => check.checkId === definition.id) ?? { checkId: definition.id, condition: 'Not checked' as const, note: '' }
          return <CheckQuestion key={definition.id} definition={definition} answer={answer} itemId={line.id} disabled={disabled} onAnswer={updateCheck} />
        })}

      <SaveNote save={save} onRetry={onRetry} />
    </li>
  )
}
