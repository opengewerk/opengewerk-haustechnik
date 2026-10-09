import type { TemplateDefinition } from '@opengewerk/haustechnik-domain'
import { GripVertical } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useId,
  useRef,
  useState,
} from 'react'

import {
  moveChapter,
  movePoint,
  placeChapter,
  placePoint,
  type PointSpot,
  spotOf,
} from './template-draft.js'

/**
 * Moving the points and the chapters of a template in the editor (#112), by
 * dragging their handle, as Moritz asked on 09.10.2026, and with the
 * keyboard: the space bar takes a point up, the arrows move it a place at a
 * time, across the edge of its chapter as well, and the space bar puts it
 * down; Escape gives back where it stood. What happens is said aloud.
 *
 * Dragged, a point follows the pointer, lifted off the list, and a copper
 * line shows where it lands; the place is worked out from the rows on the
 * screen. Moved by the keyboard, it moves in the draft at once, so nothing
 * hangs on where things are drawn.
 */

export const reorderWords = {
  how: 'Mit der Leertaste aufnehmen, mit den Pfeiltasten verschieben und mit der Leertaste ablegen. Escape bricht ab.',
  taken: (what: string) => `${what} aufgenommen.`,
  put: (what: string) => `${what} abgelegt.`,
  given: (what: string) => `${what}: Verschieben abgebrochen, alles steht wie vorher.`,
  handle: (what: string) => `${what} verschieben`,
} as const

type Kind = 'point' | 'chapter'

interface Lift {
  readonly kind: Kind
  readonly key: string
  readonly by: 'pointer' | 'keyboard'
  /** How far the pointer has gone since it took the handle, in pixels down. */
  readonly dy: number
}

/** Where a dragged point or chapter would land: for a chapter only the index counts. */
type Drop = PointSpot

/** Where a point or a chapter stands, in words, after it moved. */
function placeWords(draft: TemplateDefinition, kind: Kind, key: string): string {
  if (kind === 'chapter') {
    const index = draft.sections.findIndex((section) => section.key === key)

    return `Kapitel an Stelle ${String(index + 1)} von ${String(draft.sections.length)}.`
  }

  const spot = spotOf(draft, key)
  const section = draft.sections.find((each) => each.key === spot?.chapter)

  return spot === null || section === undefined
    ? ''
    : `Stelle ${String(spot.index + 1)} von ${String(section.fields.length)} im Kapitel „${section.title}“.`
}

function middle(element: Element): number {
  const rect = element.getBoundingClientRect()

  return rect.top + rect.height / 2
}

/** The place among the rows of the screen a pointer at this height drops on. */
function dropAt(container: HTMLElement, lift: Lift, y: number): Drop | null {
  if (lift.kind === 'chapter') {
    const chapters = [...container.querySelectorAll<HTMLElement>('[data-chapter]')].filter(
      (each) => each.dataset['chapter'] !== lift.key,
    )

    return { chapter: '', index: chapters.filter((each) => middle(each) < y).length }
  }

  const bodies = [...container.querySelectorAll<HTMLElement>('[data-chapter-body]')]
  // The chapter under the pointer, or the nearest one when it is between two.
  const distance = (body: HTMLElement) => {
    const rect = body.getBoundingClientRect()

    return y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
  }
  const body = bodies.sort((left, right) => distance(left) - distance(right))[0]

  if (body === undefined) {
    return null
  }

  const rows = [...body.querySelectorAll<HTMLElement>('[data-point]')].filter(
    (each) => each.dataset['point'] !== lift.key,
  )

  return {
    chapter: body.dataset['chapterBody'] ?? '',
    index: rows.filter((each) => middle(each) < y).length,
  }
}

/** A pointer near the edge of the window scrolls it, so a point reaches a chapter out of sight. */
function scrollNear(y: number) {
  const edge = 72

  if (y < edge) {
    window.scrollBy(0, -16)
  } else if (y > window.innerHeight - edge) {
    window.scrollBy(0, 16)
  }
}

export interface Reorder {
  /** The props of the handle of a point or a chapter, named by its label. */
  readonly handle: (kind: Kind, key: string, label: string) => ReactNode
  /** How a row is drawn while it is dragged: lifted, and where the pointer took it. */
  readonly lifted: (kind: Kind, key: string) => string | null
  readonly offset: (kind: Kind, key: string) => number
  /** Where a dragged point or chapter lands, for the copper line. */
  readonly drop: (kind: Kind) => Drop | null
  readonly said: ReactNode
}

/**
 * Moving in a draft. The rows are found inside `container`, the element the
 * editor draws its chapters in.
 */
export function useReorder(
  draft: TemplateDefinition,
  change: (next: TemplateDefinition) => void,
  container: RefObject<HTMLDivElement | null>,
): Reorder {
  const before = useRef<TemplateDefinition | null>(null)
  const start = useRef(0)
  const [lift, setLift] = useState<Lift | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [said, setSaid] = useState('')
  const howId = useId()

  const focus = (kind: Kind, key: string) => {
    requestAnimationFrame(() => {
      container.current?.querySelector<HTMLElement>(`[data-handle="${kind}:${key}"]`)?.focus()
    })
  }

  const moved = (kind: Kind, key: string, step: -1 | 1) =>
    kind === 'point' ? movePoint(draft, key, step) : moveChapter(draft, key, step)

  const onKeyDown = (kind: Kind, key: string, label: string) => (event: KeyboardEvent) => {
    const taking = event.key === ' ' || event.key === 'Enter'

    if (lift === null || lift.key !== key || lift.kind !== kind) {
      if (taking) {
        event.preventDefault()
        before.current = draft
        setLift({ kind, key, by: 'keyboard', dy: 0 })
        setSaid(`${reorderWords.taken(label)} ${placeWords(draft, kind, key)}`)
      }

      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()

      const next = moved(kind, key, event.key === 'ArrowUp' ? -1 : 1)

      change(next)
      setSaid(placeWords(next, kind, key))
      focus(kind, key)
    } else if (taking) {
      event.preventDefault()
      before.current = null
      setLift(null)
      setSaid(`${reorderWords.put(label)} ${placeWords(draft, kind, key)}`)
    } else if (event.key === 'Escape') {
      event.preventDefault()

      if (before.current !== null) {
        change(before.current)
      }

      before.current = null
      setLift(null)
      setSaid(reorderWords.given(label))
      focus(kind, key)
    }
  }

  const onPointerDown = (kind: Kind, key: string) => (event: PointerEvent<HTMLButtonElement>) => {
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
    before.current = draft
    setLift({ kind, key, by: 'pointer', dy: 0 })
    setDrop(null)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (lift?.by !== 'pointer' || container.current === null) {
      return
    }

    setLift({ ...lift, dy: event.pageY - start.current })
    setDrop(dropAt(container.current, lift, event.clientY))
    scrollNear(event.clientY)
  }

  const onPointerUp = (label: string) => () => {
    if (lift?.by !== 'pointer') {
      return
    }

    if (drop !== null) {
      const point =
        lift.kind === 'point'
          ? draft.sections
              .flatMap((section) => section.fields)
              .find((each) => each.key === lift.key)
          : undefined
      const next =
        lift.kind === 'chapter'
          ? placeChapter(draft, lift.key, drop.index)
          : point === undefined
            ? draft
            : placePoint(draft, point, drop)

      change(next)
      setSaid(`${reorderWords.put(label)} ${placeWords(next, lift.kind, lift.key)}`)
    }

    before.current = null
    setLift(null)
    setDrop(null)
  }

  const onPointerCancel = () => {
    before.current = null
    setLift(null)
    setDrop(null)
  }

  return {
    handle: (kind, key, label) => (
      <button
        type="button"
        data-handle={`${kind}:${key}`}
        aria-label={reorderWords.handle(label)}
        aria-describedby={howId}
        aria-pressed={lift?.kind === kind && lift.key === key}
        className="flex h-[30px] w-[22px] shrink-0 cursor-grab touch-none items-center justify-center rounded-[3px] text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing aria-pressed:bg-sunken aria-pressed:text-ink"
        onKeyDown={onKeyDown(kind, key, label)}
        onPointerDown={onPointerDown(kind, key)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp(label)}
        onPointerCancel={onPointerCancel}
      >
        <GripVertical size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    ),
    lifted: (kind, key) =>
      lift?.kind === kind && lift.key === key
        ? 'relative z-10 rounded border border-strong bg-surface shadow-[0_8px_20px_rgba(15,20,27,0.22)]'
        : null,
    offset: (kind, key) =>
      lift?.kind === kind && lift.key === key && lift.by === 'pointer' ? lift.dy : 0,
    drop: (kind) => (lift?.kind === kind && lift.by === 'pointer' ? drop : null),
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
  }
}

/** The copper line where a dragged point or chapter lands. */
export function DropLine() {
  return <div aria-hidden="true" className="mx-1 -my-px h-[3px] rounded-[2px] bg-solid" />
}
