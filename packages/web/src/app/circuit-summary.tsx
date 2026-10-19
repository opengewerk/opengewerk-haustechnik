import { Fragment } from 'react'

/**
 * The one line that sums up a circuit, `LS B 16 A, Typ A 30 mA, NYM-J 3 × 1,5
 * mm²`, with each of its parts kept on one line. Wrapped anywhere, a narrow
 * card breaks "NYM-J 3 ×" from "1,5 mm²", and the cross section reads as a
 * figure of its own; wrapped after a comma, every part stays whole.
 */
export function CircuitSummary({ summary }: { readonly summary: string }) {
  const parts = summary.split(', ')

  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? ', ' : null}
      <span className="whitespace-nowrap">{part}</span>
    </Fragment>
  ))
}
