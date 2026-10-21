interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span aria-current="page">
        Page {page} of {totalPages}
      </span>
      <button type="button" className="btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </nav>
  )
}
