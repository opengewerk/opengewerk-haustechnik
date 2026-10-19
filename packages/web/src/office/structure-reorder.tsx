import type { RecordState } from '@opengewerk/haustechnik-domain'
import { count, refusalFor, useSync } from '@opengewerk/platform-web/sync'
import { GripVertical } from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useId,
  useRef,
  useState,
} from 'react'

import { reorderWords } from './template-reorder.js'

/**
 * Moving the parts of the electrical structure in the office (#349): the
 * boards of an asset, the sections of a board, its circuits, also into
 * another section, and the equipment of a circuit, by the handle the boards
 * draw, as the points of a template are moved (#112). The space bar takes a
 * part up, the arrows move it a place at a time, over the edge of its section
 * as well, and the space bar puts it down; Escape gives back where it stood.
 * What happens is said aloud.
 *
 * Unlike a template, the structure has no draft that is saved later: each
 * part is written through the outbox when it is put down, the parts behind it
 * numbered afresh, as `moveAmong` of the foundation numbers them. Taken up by
 * the keyboard, a part moves on the screen and is written once, where it is
 * put down, not at every step on the way.
 */

/** The parts of one place, in their order: a section with its circuits, or a whole list. */
export interface MoveGroup {
  /** The id of the section, or the empty text for a list of one place. */
  readonly key: string
  readonly items: readonly RecordState[]
}

interface Lift {
  readonly id: string
  readonly by: 'pointer' | 'keyboard'
  /** How far the pointer has gone since it took the handle, in pixels down. */
  readonly dy: number
}

/** Where a part stands or lands: its group, and its place among the others there. */
interface Spot {
  readonly key: string
  readonly index: number
}

const idOf = (record: RecordState) => String(record['id'])

function spotOf(groups: readonly MoveGroup[], id: string): Spot | null {
  for (const group of groups) {
    const index = group.items.findIndex((record) => idOf(record) === id)

    if (index >= 0) {
      return { key: group.key, index }
    }
  }

  return null
}

/** The groups with one part taken out and put in again at a spot. */
function placed(groups: readonly MoveGroup[], id: string, spot: Spot): readonly MoveGroup[] {
  const moved = groups.flatMap((group) => group.items).find((record) => idOf(record) === id)

  if (moved === undefined) {
    return groups
  }

  return groups.map((group) => {
    const others = group.items.filter((record) => idOf(record) !== id)

    if (group.key !== spot.key) {
      return { key: group.key, items: others }
    }

    others.splice(Math.max(0, Math.min(others.length, spot.index)), 0, moved)

    return { key: group.key, items: others }
  })
}

/** One step up or down, over the edge of a group into the next one. */
function stepped(groups: readonly MoveGroup[], id: string, step: -1 | 1): Spot | null {
  const spot = spotOf(groups, id)

  if (spot === null) {
    return null
  }

  const at = groups.findIndex((group) => group.key === spot.key)
  const length = groups[at]?.items.length ?? 0
  const next = spot.index + step

  if (next >= 0 && next < length) {
    return { key: spot.key, index: next }
  }

  const neighbour = groups[at + step]

  // The others of the neighbour, without the part itself: it lands after
  // the last of the group above, or before the first of the one below.
  return neighbour === undefined
    ? null
    : { key: neighbour.key, index: step < 0 ? neighbour.items.length : 0 }
}

function middle(element: Element): number {
  const rect = element.getBoundingClientRect()

  return rect.top + rect.height / 2
}

/** The place among the rows of the screen a pointer at this height drops on. */
function dropAt(container: HTMLElement, scope: string, id: string, y: number): Spot | null {
  const bodies = [...container.querySelectorAll<HTMLElement>(`[data-move-group^="${scope}:"]`)]
  // The group under the pointer, or the nearest one when it is between two.
  const distance = (body: HTMLElement) => {
    const rect = body.getBoundingClientRect()

    return y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
  }
  const body = bodies.sort((left, right) => distance(left) - distance(right))[0]

  if (body === undefined) {
    return null
  }

  const rows = [...body.querySelectorAll<HTMLElement>(`[data-move-row^="${scope}:"]`)].filter(
    (row) => row.dataset['moveRow'] !== `${scope}:${id}`,
  )

  return {
    key: (body.dataset['moveGroup'] ?? '').slice(scope.length + 1),
    index: rows.filter((row) => middle(row) < y).length,
  }
}

/** A pointer near the edge of the window scrolls it, so a part reaches a section out of sight. */
function scrollNear(y: number) {
  const edge = 72

  if (y < edge) {
    window.scrollBy(0, -16)
  } else if (y > window.innerHeight - edge) {
    window.scrollBy(0, 16)
  }
}

export interface StructureMoves {
  /** The groups as they stand, with a part the keyboard holds where it is going. */
  readonly groups: readonly MoveGroup[]
  /** The handle of a part, named by its designation. */
  readonly handle: (id: string, label: string) => ReactNode
  /** What marks the element of a group, the one its rows stand in. */
  readonly body: (key: string) => { readonly 'data-move-group': string }
  /**
   * What marks the row of a part, and how it is drawn while it is dragged:
   * lifted, and where the pointer took it. `look` is how it is drawn
   * otherwise, `rest` what it keeps either way.
   */
  readonly row: (
    id: string,
    look: string,
    rest?: string,
  ) => {
    readonly 'data-move-row': string
    readonly className: string
    readonly style: CSSProperties | undefined
  }
  /** Where in a group a dragged part lands, among the others there, for the copper line. */
  readonly dropIndex: (key: string) => number | null
  /** The part being moved, which the copper line does not count. */
  readonly moving: string | null
  readonly said: ReactNode
  /** What the outbox refused, as its sentence. */
  readonly trouble: string | null
}

/**
 * Moving the parts of `groups`. The rows are found inside `container`, by
 * what `body` and `row` mark them with; `scope` keeps the marks of two kinds
 * of part apart where one stands inside the other, a circuit in a section.
 */
export function useStructureMoves({
  scope,
  entity,
  groups,
  field,
  where,
  container,
}: {
  /** A word for the kind of part, unique on the page. */
  readonly scope: string
  readonly entity: string
  readonly groups: readonly MoveGroup[]
  /**
   * The field that names the group of a part, for parts that move between
   * groups: the section of a circuit, empty for the board itself.
   */
  readonly field?: string
  /** Where a group is, as it is said aloud after the place: "im Feld „Feld 1“". */
  readonly where?: (key: string) => string
  readonly container: RefObject<HTMLElement | null>
}): StructureMoves {
  const client = useSync()
  const start = useRef(0)
  const [lift, setLift] = useState<Lift | null>(null)
  const [draft, setDraft] = useState<readonly MoveGroup[] | null>(null)
  const [drop, setDrop] = useState<Spot | null>(null)
  const [said, setSaid] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const howId = useId()
  const shown = draft ?? groups

  const placeWords = (within: readonly MoveGroup[], id: string): string => {
    const spot = spotOf(within, id)
    const group = within.find((each) => each.key === spot?.key)

    if (spot === null || group === undefined) {
      return ''
    }

    const place = `Stelle ${String(spot.index + 1)} von ${String(group.items.length)}`

    return where ? `${place} ${where(group.key)}.` : `${place}.`
  }

  const focus = (id: string) => {
    requestAnimationFrame(() => {
      container.current?.querySelector<HTMLElement>(`[data-handle="${scope}:${id}"]`)?.focus()
    })
  }

  /**
   * Writes the part where it was put down, and every other part of its group
   * whose number changes. A part that changes its group says so in `field`.
   */
  async function write(id: string, spot: Spot) {
    const from = spotOf(groups, id)
    const target = placed(groups, id, spot).find((group) => group.key === spot.key)

    if (from === null || target === undefined) {
      return
    }

    for (const [index, record] of target.items.entries()) {
      const patch: Record<string, unknown> = {}

      if (count(record, 'position') !== index) {
        patch['position'] = index
      }

      if (field !== undefined && idOf(record) === id && from.key !== spot.key) {
        patch[field] = spot.key === '' ? null : spot.key
      }

      if (Object.keys(patch).length > 0) {
        const result = await client.update(entity, idOf(record), patch)

        if (result.outcome === 'refused') {
          setTrouble(refusalFor(result))

          return
        }
      }
    }

    setTrouble(null)
  }

  const onKeyDown = (id: string, label: string) => (event: KeyboardEvent) => {
    const taking = event.key === ' ' || event.key === 'Enter'

    if (lift === null || lift.id !== id) {
      if (taking) {
        event.preventDefault()
        setLift({ id, by: 'keyboard', dy: 0 })
        setDraft(groups)
        setSaid(`${reorderWords.taken(label)} ${placeWords(groups, id)}`)
      }

      return
    }

    if (lift.by !== 'keyboard') {
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()

      const spot = stepped(shown, id, event.key === 'ArrowUp' ? -1 : 1)

      if (spot !== null) {
        const next = placed(shown, id, spot)

        setDraft(next)
        setSaid(placeWords(next, id))
        focus(id)
      }
    } else if (taking) {
      event.preventDefault()

      const spot = spotOf(shown, id)

      setLift(null)
      setDraft(null)
      setSaid(`${reorderWords.put(label)} ${placeWords(shown, id)}`)

      if (spot !== null) {
        void write(id, spot)
      }

      focus(id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setLift(null)
      setDraft(null)
      setSaid(reorderWords.given(label))
      focus(id)
    }
  }

  const onPointerDown = (id: string) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()

    // Captured, the pointer stays with the handle wherever it goes; a pointer
    // the browser does not know, one made up by a script, goes without.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // nothing to capture
    }

    start.current = event.pageY
    setDraft(null)
    setLift({ id, by: 'pointer', dy: 0 })
    setDrop(null)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (lift?.by !== 'pointer' || container.current === null) {
      return
    }

    setLift({ ...lift, dy: event.pageY - start.current })
    setDrop(dropAt(container.current, scope, lift.id, event.clientY))
    scrollNear(event.clientY)
  }

  const onPointerUp = (label: string) => () => {
    if (lift?.by !== 'pointer') {
      return
    }

    if (drop !== null) {
      setSaid(`${reorderWords.put(label)} ${placeWords(placed(groups, lift.id, drop), lift.id)}`)
      void write(lift.id, drop)
    }

    setLift(null)
    setDrop(null)
  }

  const onPointerCancel = () => {
    setLift(null)
    setDrop(null)
  }

  return {
    groups: shown,
    handle: (id, label) => (
      <button
        type="button"
        data-handle={`${scope}:${id}`}
        aria-label={reorderWords.handle(label)}
        aria-describedby={howId}
        aria-pressed={lift?.id === id}
        className="flex h-[30px] w-[22px] shrink-0 cursor-grab touch-none items-center justify-center rounded-[3px] text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing aria-pressed:bg-sunken aria-pressed:text-ink"
        onKeyDown={onKeyDown(id, label)}
        onPointerDown={onPointerDown(id)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp(label)}
        onPointerCancel={onPointerCancel}
      >
        <GripVertical size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    ),
    body: (key) => ({ 'data-move-group': `${scope}:${key}` }),
    row: (id, look, rest = '') => ({
      'data-move-row': `${scope}:${id}`,
      className: [
        lift?.id === id
          ? 'relative z-10 rounded border border-strong bg-surface shadow-[0_8px_20px_rgba(15,20,27,0.22)]'
          : look,
        rest,
      ]
        .filter(Boolean)
        .join(' '),
      style:
        lift?.id === id && lift.by === 'pointer' && lift.dy !== 0
          ? { transform: `translateY(${String(lift.dy)}px)` }
          : undefined,
    }),
    dropIndex: (key) => (lift?.by === 'pointer' && drop?.key === key ? drop.index : null),
    moving: lift?.id ?? null,
    said: (
      <>
        <span id={howId} className="sr-only">
          {reorderWords.how}
        </span>
        <span aria-live="assertive" className="sr-only">
          {said}
        </span>
      </>
    ),
    trouble,
  }
}

/**
 * The rows of a group with the copper line where a dragged part lands, which
 * stands among the other parts and does not count the one being moved.
 */
export function withDropLine(
  moves: StructureMoves,
  group: MoveGroup,
  row: (record: RecordState) => ReactNode,
  line: (key: string) => ReactNode,
): ReactNode[] {
  const at = moves.dropIndex(group.key)
  const rows: ReactNode[] = []
  let standing = 0

  for (const record of group.items) {
    if (at === standing && idOf(record) !== moves.moving) {
      rows.push(line(`drop-${idOf(record)}`))
    }

    rows.push(row(record))

    if (idOf(record) !== moves.moving) {
      standing += 1
    }
  }

  if (at !== null && at >= standing) {
    rows.push(line('drop-end'))
  }

  return rows
}
