/**
 * Two or more choices side by side, one of them pressed, `segmented()` of
 * the boards: the view of a property and the grid of the figures.
 */
export function Segmented({
  label,
  options,
  chosen,
  onChoose,
}: {
  readonly label: string
  readonly options: readonly string[]
  readonly chosen: number
  readonly onChoose: (index: number) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-0.5 rounded-control border border-line bg-surface-sunken p-[3px]"
    >
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          aria-pressed={index === chosen}
          onClick={() => {
            onChoose(index)
          }}
          className={`h-[26px] cursor-pointer whitespace-nowrap rounded-[3px] border-0 px-2.5 text-[13px] ${
            index === chosen ? 'bg-ink font-semibold text-ground' : 'bg-transparent text-ink'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
