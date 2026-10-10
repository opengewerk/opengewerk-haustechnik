import { Link } from '@tanstack/react-router'

/**
 * The numbers over a list or a preview, `count_tile()` of the canvas: a
 * figure, what it counts, and a line under it, with an edge on top in the
 * tone of what it counts.
 *
 * A tile with a place is a link to the list it counts, narrowed as the
 * address says (4.1 and 4.3 of the concept: "Jede Zahl ist ein Link auf die
 * gefilterte Liste"); the whole tile is the link, and it is named by its
 * figure and what it counts.
 */

export type Tone = 'neutral' | 'waiting' | 'conflict' | 'done'

export interface Tile {
  readonly value: number
  readonly label: string
  readonly tone?: Tone
  readonly sub?: string
  /** The list the figure counts, and what its address narrows it to. */
  readonly to?: string
  readonly search?: Readonly<Record<string, string>>
}

const tileEdge: Readonly<Record<Tone, string>> = {
  neutral: 'border-t-line',
  waiting: 'border-t-waiting-edge',
  conflict: 'border-t-conflict',
  done: 'border-t-done-edge',
}

const tileInk: Readonly<Record<Tone, string>> = {
  neutral: 'text-ink',
  waiting: 'text-waiting',
  conflict: 'text-conflict',
  done: 'text-done',
}

export function CountTiles({
  label,
  tiles,
  className = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
}: {
  readonly label: string
  readonly tiles: readonly Tile[]
  /** The columns of the grid, five from 1024 pixels unless a screen says otherwise. */
  readonly className?: string
}) {
  return (
    <ul aria-label={label} className={`grid gap-2.5 ${className}`}>
      {tiles.map((tile) => {
        const box = `block h-full rounded-[5px] border border-t-[3px] border-line bg-surface px-[13px] py-[11px] ${tileEdge[tile.tone ?? 'neutral']}`
        const content = (
          <>
            <div
              className={`text-[26px] leading-[1.1] font-semibold tabular-nums ${tileInk[tile.tone ?? 'neutral']}`}
            >
              {tile.value.toLocaleString('de-DE')}
            </div>
            <div className="mt-[3px] text-[13px] text-ink">{tile.label}</div>
            {tile.sub ? <div className="mt-0.5 text-[12px] text-ink-faint">{tile.sub}</div> : null}
          </>
        )

        return (
          <li key={tile.label}>
            {tile.to === undefined ? (
              <div className={box}>{content}</div>
            ) : (
              <Link
                to={tile.to}
                search={tile.search ?? {}}
                className={`${box} no-underline hover:border-line-strong`}
              >
                {content}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
