import { Button, Confirm } from '@opengewerk/platform-web'
import { Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { type EditResult, refusalFor } from '@opengewerk/platform-web/sync'
import { Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { officePlaces } from './place-addresses.js'

/**
 * What the forms of a property, a building, a floor and a room share in the
 * office (4.1 of the concept): what stands in place of a form for somebody
 * who may not fill it in, and the question before a place is removed.
 */

/** In place of a form, for whoever may not fill it in. */
export function NotAllowed({ children }: { readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead title="Liegenschaften" crumbs={[officePlaces.list]} />
      <Empty>{children}</Empty>
    </Screen>
  )
}

/**
 * Removing a place, with a question first. Everything in it goes with it, and
 * the question says so; what holds evidence stays, and the server says that
 * when it refuses.
 *
 * It stands among the buttons of a form, a row that wraps and gathers at the
 * right. Alone on a line the button stays at the left, and the sentence of
 * the server takes a line after all the buttons, so that none of them moves
 * when it appears.
 */
export function RemovePlace({
  label,
  question,
  disabled,
  remove,
  onRemoved,
  children,
}: {
  /** The word on the button: "Gebäude entfernen". */
  readonly label: string
  /** The question, with the name of the place in it. */
  readonly question: string
  readonly disabled: boolean
  /** Removes it, at the route that owns it. */
  readonly remove: () => Promise<EditResult>
  /** Where to go once it is gone. */
  readonly onRemoved: () => void | Promise<void>
  /** What goes with it, and what does not. */
  readonly children: ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  return (
    <>
      <Button
        tone="danger"
        icon={Trash2}
        className="mr-auto"
        disabled={disabled}
        onClick={() => {
          setTrouble(null)
          setAsking(true)
        }}
      >
        {label}
      </Button>
      {trouble ? (
        <p role="alert" className="order-last basis-full text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <Confirm
        open={asking}
        title={question}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          void remove().then(async (result) => {
            if (result.outcome === 'refused') {
              setTrouble(refusalFor(result))

              return
            }

            await onRemoved()
          })
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        {children}
      </Confirm>
    </>
  )
}
