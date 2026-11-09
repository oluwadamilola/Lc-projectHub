import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AddEquipmentResponse } from '@lc-projecthub/shared'
import { validateEquipmentItemInput } from '@lc-projecthub/shared'
import { addInspectionEquipment, getEquipmentTypes } from '../api/audit'
import { ApiRequestError } from '../api/http'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorSummary } from './ErrorSummary'
import { FormField } from './FormField'
import { ErrorState, LoadingState } from './StateMessage'

interface AddEquipmentFormProps {
  inspectionId: string
  roomId: string
  onAdded: (response: AddEquipmentResponse) => void
  onCancel: () => void
}

const FIELDS = ['equipmentTypeId', 'name', 'assetTag', 'serialNumber']

/**
 * Adds equipment the inspector found in the room. The server adds it to the inventory (flagged "Needs review") and to
 * this checklist in one step. Problems are shown by the same shared rule the server uses; a clash with an existing
 * asset tag can only be known by the server, so it comes back as a message on the asset tag.
 */
export function AddEquipmentForm({ inspectionId, roomId, onAdded, onCancel }: AddEquipmentFormProps) {
  const types = useApiResource((signal) => getEquipmentTypes(signal), [])
  const [typeId, setTypeId] = useState('')
  const [name, setName] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'center' })
  }, [types.data])

  const typeList = types.data?.data ?? []
  const selected = typeList.find((type) => type.id === typeId)

  const fail = (next: Record<string, string>, form: string | null) => {
    setErrors(next)
    setFormError(form)
    setTimeout(() => summaryRef.current?.focus(), 0)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return
    const input = { roomId, equipmentTypeId: typeId, name: name.trim(), assetTag: assetTag.trim() || null, serialNumber: serialNumber.trim() || null }
    const checked = validateEquipmentItemInput(input, typeList)
    if (!checked.ok) {
      fail(Object.fromEntries(checked.errors.filter((problem) => FIELDS.includes(problem.field)).map((problem) => [problem.field, problem.message])), null)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setErrors({})
    setFormError(null)
    try {
      const response = await addInspectionEquipment(inspectionId, {
        equipmentTypeId: checked.value.equipmentTypeId,
        name: checked.value.name,
        assetTag: checked.value.assetTag,
        serialNumber: checked.value.serialNumber,
      })
      onAdded(response)
    } catch (error) {
      const failure = error instanceof ApiRequestError ? error : new ApiRequestError('Something went wrong. Please try again.', 0)
      const fieldErrors = Object.fromEntries(failure.details.filter((problem) => FIELDS.includes(problem.field)).map((problem) => [problem.field, problem.message]))
      if (failure.status === 409 && assetTag.trim() && /asset tag/i.test(failure.message)) fieldErrors.assetTag = failure.message
      fail(fieldErrors, Object.keys(fieldErrors).length > 0 ? null : failure.message)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (types.status === 'loading' && !types.data) return <LoadingState label="Loading equipment types…" />
  if (types.status === 'error') return <ErrorState title="Equipment types could not be loaded" message={types.error.message} onRetry={types.reload} />

  const problems = Object.entries(errors)
  return (
    <form ref={formRef} className="card form-card add-equipment" onSubmit={submit} noValidate aria-labelledby="add-equipment-heading">
      <h2 id="add-equipment-heading">Add equipment found in this room</h2>
      <p className="form-note">
        It is added to the room&apos;s equipment and to this checklist, and marked <strong>Needs review</strong> until the inventory is checked.
      </p>
      {(problems.length > 0 || formError) && (
        <ErrorSummary formError={formError} problems={problems} isField={(field) => FIELDS.includes(field)} summaryRef={summaryRef} />
      )}
      <div className="form-grid">
        <FormField name="equipmentTypeId" label="Type of equipment" error={errors.equipmentTypeId}>
          {(props) => (
            <select {...props} className="input" value={typeId} onChange={(event) => setTypeId(event.target.value)}>
              <option value="">Choose a type…</option>
              {typeList.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField name="name" label={selected?.requiresName ? 'Name (required for this type)' : 'Name (optional)'} error={errors.name}>
          {(props) => <input {...props} className="input" type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
        </FormField>
        <FormField name="assetTag" label="Asset tag (optional)" hint="Letters, digits and hyphens, for example AT-00123." error={errors.assetTag}>
          {(props) => <input {...props} className="input" type="text" value={assetTag} onChange={(event) => setAssetTag(event.target.value)} autoComplete="off" />}
        </FormField>
        <FormField name="serialNumber" label="Serial number (optional)" error={errors.serialNumber}>
          {(props) => <input {...props} className="input" type="text" value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} autoComplete="off" />}
        </FormField>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn--primary btn--large" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add to this room'}
        </button>
        <button type="button" className="btn btn--large" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}

