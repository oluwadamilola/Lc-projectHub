import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  INSPECTION_FILTERS,
  MAX_SEARCH_LENGTH,
  ROOM_STATUS_FILTERS,
  type InspectionFilter,
  type RoomStatusFilter,
} from '@lc-projecthub/shared'
import { getAuditBlock, getAuditRooms } from '../api/audit'
import { InspectionStatusBadge, RoomStatusBadge } from '../components/AuditBadges'
import { CycleBar } from '../components/CycleBar'
import { Pagination } from '../components/Pagination'
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage'
import { useApiResource } from '../hooks/useApiResource'
import { INSPECTION_FILTER_LABELS, describeInspection, describeProgress, describeRemaining, plural, readCycle, withCycle } from '../lib/audit'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300
const STATUS_LABELS: Record<RoomStatusFilter, string> = { active: 'Active rooms', retired: 'Retired rooms', all: 'All rooms' }

const readStatus = (value: string | null): RoomStatusFilter => ROOM_STATUS_FILTERS.find((status) => status === value) ?? 'active'
const readInspection = (value: string | null): InspectionFilter => INSPECTION_FILTERS.find((filter) => filter === value) ?? 'all'
const readPage = (value: string | null): number => {
  const page = Number(value)
  return Number.isInteger(page) && page >= 1 ? page : 1
}

function BackLink({ cycleId }: { cycleId?: string }) {
  return (
    <Link className="back-link" to={withCycle('/audit', cycleId)}>
      ← Back to audit overview
    </Link>
  )
}

/**
 * The rooms of one block, optionally one floor (the floor is in the address: /audit/blocks/:id/floors/:floorId).
 * Cycle, search, filters and page live in the query string, so a view can be bookmarked, shared and used with Back.
 */
export function AuditBlockPage() {
  const { id = '', floorId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const cycleParam = readCycle(searchParams.get('cycle'))
  const q = (searchParams.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH)
  const status = readStatus(searchParams.get('status'))
  const inspection = readInspection(searchParams.get('inspection'))
  const page = readPage(searchParams.get('page'))
  const [searchText, setSearchText] = useState(q)

  const updateParams = useCallback(
    (changes: { q?: string; status?: string; inspection?: string; cycle?: string; page?: number }) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            if (
              value === undefined ||
              value === '' ||
              (key === 'page' && value === 1) ||
              (key === 'status' && value === 'active') ||
              (key === 'inspection' && value === 'all')
            )
              next.delete(key)
            else next.set(key, String(value))
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Wait for a pause in typing before searching, and go back to page 1 for a new search.
  useEffect(() => {
    const trimmed = searchText.trim()
    if (trimmed === q) return
    const timer = window.setTimeout(() => updateParams({ q: trimmed, page: 1 }), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText, q, updateParams])

  const block = useApiResource((signal) => getAuditBlock(id, cycleParam, signal), [id, cycleParam ?? ''])
  const rooms = useApiResource(
    (signal) => getAuditRooms({ block: id, floor: floorId, q: q || undefined, status, inspection, cycle: cycleParam, page, pageSize: PAGE_SIZE }, signal),
    [id, floorId ?? '', q, status, inspection, cycleParam ?? '', page],
  )

  const filtered = q !== '' || status !== 'active' || inspection !== 'all' || page !== 1
  function clearFilters() {
    setSearchText('')
    setSearchParams(cycleParam ? { cycle: cycleParam } : {}, { replace: true })
  }
  // Changing floor keeps the cycle, search and filters but starts again from the first page.
  const keptQuery = new URLSearchParams(searchParams)
  keptQuery.delete('page')
  const floorLink = (path: string) => (keptQuery.toString() ? `${path}?${keptQuery.toString()}` : path)

  if (block.status === 'loading' && !block.data) {
    return (
      <>
        <BackLink cycleId={cycleParam} />
        <LoadingState label="Loading block…" />
      </>
    )
  }
  if (block.status === 'error') {
    const notFound = block.error.status === 404
    return (
      <>
        <BackLink cycleId={cycleParam} />
        <section className="card">
          <ErrorState
            title={notFound ? 'Block or cycle not found' : 'The block could not be loaded'}
            message={notFound ? `There is no block ${id}, or that inspection cycle does not exist. Choose a block from the audit overview.` : block.error.message}
            onRetry={notFound ? undefined : block.reload}
          />
        </section>
      </>
    )
  }

  const detail = block.data!.data
  const cycle = block.data!.cycle
  const cycleId = cycleParam ?? cycle?.id
  const selectedFloor = detail.floors.find((floor) => floor.id === floorId)
  const scopeProgress = (selectedFloor ?? detail).progress
  const data = rooms.data
  const showError = rooms.status === 'error'
  const showLoading = rooms.status === 'loading' && !data
  const blockPath = `/audit/blocks/${encodeURIComponent(detail.id)}`

  return (
    <>
      <BackLink cycleId={cycleParam} />
      <div className="page-header">
        <div>
          <p className="detail-ref">{detail.code}</p>
          <h1>{detail.name}</h1>
          <p>
            {plural(detail.floorCount, 'floor')} · {plural(detail.roomCount, 'active room')}
            {detail.retiredRoomCount > 0 ? ` · ${detail.retiredRoomCount} retired` : ''}
          </p>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      <CycleBar current={cycle} onChange={(next) => updateParams({ cycle: next, page: 1 })} />

      <p className="section-note" role="status">
        {selectedFloor ? `${selectedFloor.name}: ` : `${detail.name}: `}
        {describeProgress(scopeProgress)}
        {describeRemaining(scopeProgress) && ` · ${describeRemaining(scopeProgress)}`}
      </p>

      <nav className="floor-nav" aria-label="Floors">
        <ul>
          <li>
            <Link to={floorLink(blockPath)} aria-current={floorId === undefined ? 'page' : undefined} className="floor-nav__link">
              All floors <span className="floor-nav__count">{detail.roomCount}</span>
            </Link>
          </li>
          {detail.floors.map((floor) => (
            <li key={floor.id}>
              <Link
                to={floorLink(`${blockPath}/floors/${encodeURIComponent(floor.id)}`)}
                aria-current={floor.id === floorId ? 'page' : undefined}
                className="floor-nav__link"
              >
                {floor.name} <span className="floor-nav__count">{floor.roomCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="card" aria-label="Room list">
        <form className="toolbar toolbar--audit" role="search" aria-label="Find rooms" onSubmit={(event) => event.preventDefault()}>
          <div className="field">
            <label className="field__label" htmlFor="room-search">
              Search rooms
            </label>
            <input
              id="room-search"
              className="input"
              type="search"
              placeholder="Room code or name"
              maxLength={MAX_SEARCH_LENGTH}
              value={searchText}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="room-inspection">
              Inspection
            </label>
            <select id="room-inspection" className="input" value={inspection} onChange={(event) => updateParams({ inspection: event.target.value, page: 1 })}>
              {INSPECTION_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {INSPECTION_FILTER_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="room-status">
              Show
            </label>
            <select id="room-status" className="input" value={status} onChange={(event) => updateParams({ status: event.target.value, page: 1 })}>
              {ROOM_STATUS_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={clearFilters} disabled={!filtered && searchText === ''}>
            Clear filters
          </button>
        </form>

        {showLoading && <LoadingState label="Loading rooms…" />}

        {showError && <ErrorState title="Rooms could not be loaded" message={rooms.error.message} onRetry={rooms.reload} />}

        {data && !showError && (
          <div className="results" aria-busy={rooms.status === 'loading'}>
            {data.data.length === 0 ? (
              <EmptyState title={filtered ? 'No rooms match your filters' : selectedFloor ? 'There are no rooms on this floor yet' : 'There are no rooms in this block yet'}>
                {filtered && (
                  <>
                    <p>Try a different search or choose another filter.</p>
                    <button type="button" className="btn" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </>
                )}
              </EmptyState>
            ) : (
              <>
                <p className="results-summary" role="status">
                  Showing {(data.meta.page - 1) * data.meta.pageSize + 1}–{(data.meta.page - 1) * data.meta.pageSize + data.data.length} of{' '}
                  {data.meta.total} rooms
                </p>
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Rooms table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Room</th>
                        <th scope="col">Name</th>
                        <th scope="col">Floor</th>
                        <th scope="col">Equipment</th>
                        <th scope="col">Inspection</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((room) => (
                        <tr key={room.id}>
                          <th scope="row" className="data-table__primary nowrap">
                            <Link className="table-link" to={withCycle(`/audit/rooms/${encodeURIComponent(room.id)}`, cycleId)}>
                              {room.code}
                            </Link>
                          </th>
                          <td>{room.displayName || <span className="muted">—</span>}</td>
                          <td className="nowrap">{room.floorName}</td>
                          <td className="nowrap">
                            {room.equipmentCount === 0 ? <span className="muted">No equipment</span> : plural(room.equipmentCount, 'item')}
                            {room.itemsNeedingReview > 0 && <span className="data-table__sub">{room.itemsNeedingReview} to review</span>}
                          </td>
                          <td>
                            <InspectionStatusBadge inspection={room.inspection} />
                            {describeInspection(room.inspection) && <span className="data-table__sub">{describeInspection(room.inspection)}</span>}
                          </td>
                          <td className="nowrap">
                            <RoomStatusBadge active={room.active} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPageChange={(next) => updateParams({ page: next })} />
          </div>
        )}
      </section>
    </>
  )
}
