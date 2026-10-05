import { type CatalogueReview, reviewMarks } from '@opengewerk/haustechnik-domain'
import { Status } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * What a reader is told about an entry of the catalogue, wherever one is
 * shown (section 5 of the concept): that nobody with expertise has accepted
 * it, and that its last check against the source lies more than a year back.
 *
 * In one place, for both entries, so that the catalogue, a proposal, the file
 * of an asset and a protocol say it in the same words. Which entries are
 * marked is decided by `reviewMarks` in the domain package.
 */

export const unacceptedWords = 'Nicht abgenommen'
export const checkedLongAgoWords = 'Seit über einem Jahr nicht geprüft'
/** The same inside a sentence, after a day or a comma. */
const checkedLongAgoWithin = 'seit über einem Jahr nicht geprüft'

/**
 * A mark at an entry, `review_mark()` of the canvas: dashed and without a
 * fill, so that it reads as a reservation about the entry and not as a state
 * of the tenant's own record beside it.
 */
export function ReviewMark({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-[3px] border border-dashed border-waiting-edge px-[7px] py-px text-[12px] font-semibold leading-[1.3] text-waiting">
      <Info size={12} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
      {children}
    </span>
  )
}

/** The marks of an entry beside its name: none for one accepted and checked within the year. */
export function ReviewMarks({ review }: { readonly review: CatalogueReview }) {
  const marks = reviewMarks(review, today())

  return (
    <>
      {marks.unaccepted ? <ReviewMark>{unacceptedWords}</ReviewMark> : null}
      {marks.checkedLongAgo ? <ReviewMark>{checkedLongAgoWords}</ReviewMark> : null}
    </>
  )
}

/** The column "Abnahme" of a list of entries: every row says one of the two. */
export function Acceptance({ review }: { readonly review: CatalogueReview }) {
  return review.accepted === null ? (
    <ReviewMark>{unacceptedWords}</ReviewMark>
  ) : (
    <Status tone="done">Abgenommen</Status>
  )
}

/**
 * The column "Zuletzt geprüft": the day, and for one more than a year back
 * the same words as the mark, heard and not only seen in another colour.
 */
export function CheckedOn({ review }: { readonly review: CatalogueReview }) {
  return reviewMarks(review, today()).checkedLongAgo ? (
    <span className="numeric font-semibold text-waiting">
      {date(review.checkedOn)}
      <span className="sr-only">, {checkedLongAgoWithin}</span>
    </span>
  ) : (
    <span className="numeric">{date(review.checkedOn)}</span>
  )
}

/** Both columns in a line, for the box of a row on a phone. */
export function reviewLine(review: CatalogueReview): string {
  const marks = reviewMarks(review, today())

  return [
    marks.unaccepted ? unacceptedWords : 'Abgenommen',
    marks.checkedLongAgo
      ? `${checkedLongAgoWithin} (${date(review.checkedOn)})`
      : `geprüft am ${date(review.checkedOn)}`,
  ].join(' · ')
}
