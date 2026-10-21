/** Visual bar plus a text percentage; the text is what assistive technology reads. */
export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress">
      <div className="progress__track" aria-hidden="true">
        <div className="progress__fill" style={{ width: `${value}%` }} />
      </div>
      <span className="progress__label">{value}%</span>
    </div>
  )
}
