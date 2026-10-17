import type { DelegationEntry } from '@opengewerk/haustechnik-domain'
import { Button, Dialog, Status, TablePanel, Cell, Column } from '@opengewerk/platform-web'
import { Empty } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Signature } from 'lucide-react'
import { useState } from 'react'

import {
  delegationKey,
  delegationPdf,
  delegationQuery,
  myDelegationsQuery,
} from './delegation-addresses.js'
import { usePdf } from './pdf-button.js'
import {
  areaTitle,
  DelegationStateStatus,
  DelegationTerms,
  periodWords,
  SignHere,
  useScopeWords,
} from './screens/delegations.js'

/**
 * "Ihre Pflichtenübertragungen" under "Konto" (#336, 4.3 of the concept):
 * the delegations to the person signed in, from the signature of the Leitung
 * on. One waiting for their signature opens to be read whole and signed; one
 * they signed hands out its PDF, the copy they keep. Nothing for somebody to
 * whom nothing was delegated.
 */

export const myDelegationWords = {
  note: 'Ihre Ausfertigung ist das PDF der Übertragung mit beiden Unterschriften. Eine Übertragung gilt erst, wenn Sie unterschrieben haben.',
  waiting: 'Wartet auf Ihre Unterschrift',
  copy: 'Ausfertigung',
  signNote:
    'Mit Ihrer Unterschrift nehmen Sie die Pflichten an, wie sie hier stehen. Danach gilt die Übertragung; ändern lässt sie sich nicht.',
  failed: 'Die Pflichtenübertragung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
} as const

function Copy({ entry }: { readonly entry: DelegationEntry }) {
  const pdf = usePdf(
    delegationPdf(entry.id),
    `Pflichtenübertragung ${entry.delegateName}`,
    myDelegationWords.copy,
  )

  return (
    <div className="flex flex-col items-end gap-1">
      {pdf.button}
      {pdf.trouble}
    </div>
  )
}

/** The delegation read whole, with the way to sign it. */
function SignDialog({ id, onClose }: { readonly id: string; readonly onClose: () => void }) {
  const queries = useQueryClient()
  const reading = useQuery(delegationQuery(id))
  const operator = reading.data?.signatures.find((signature) => signature.role === 'operator')

  return (
    <Dialog title="Pflichtenübertragung unterschreiben" width={640} onClose={onClose}>
      {reading.data === undefined ? (
        <Empty>
          {reading.isError
            ? reading.error instanceof RequestRefused
              ? reading.error.message
              : myDelegationWords.failed
            : 'Die Pflichtenübertragung wird geladen.'}
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <DelegationTerms reading={reading.data} />
          {operator === undefined ? null : (
            <p className="text-[13px] text-ink-muted">{`Für den Betreiber unterschrieben von ${operator.name}.`}</p>
          )}
          <SignHere
            reading={reading.data}
            note={myDelegationWords.signNote}
            onSigned={() => {
              void queries.invalidateQueries({ queryKey: delegationKey })
              onClose()
            }}
            onCancel={onClose}
          />
        </div>
      )}
    </Dialog>
  )
}

export function MyDelegationsCard() {
  const reads = useRight('duty.read')
  const mine = useQuery({ ...myDelegationsQuery, enabled: reads })
  const scopeWords = useScopeWords()
  const [signing, setSigning] = useState<string | null>(null)
  const rows = mine.data ?? []

  if (!reads || rows.length === 0) {
    return null
  }

  const action = (entry: DelegationEntry) =>
    entry.state === 'waiting' ? (
      <Button
        size="small"
        icon={Signature}
        onClick={() => {
          setSigning(entry.id)
        }}
      >
        Lesen und unterschreiben
      </Button>
    ) : (
      <Copy entry={entry} />
    )
  const title = (entry: DelegationEntry) => `Pflichtenübertragung, ${areaTitle(entry)}`

  return (
    <>
      <TablePanel
        title="Ihre Pflichtenübertragungen"
        caption="Ihre Pflichtenübertragungen mit Umfang, Zeitraum und Stand"
        grow={false}
        note={myDelegationWords.note}
        cards={rows.map((entry) => ({
          key: entry.id,
          title: title(entry),
          sub: [scopeWords(entry), periodWords(entry)].join(' · '),
          right: action(entry),
        }))}
      >
        <thead>
          <tr>
            <Column className="min-w-[220px]">Übertragung</Column>
            <Column className="w-[220px] min-w-[180px]">Stand</Column>
            <Column className="w-[220px] min-w-[180px]">
              <span className="sr-only">Was zu tun ist</span>
            </Column>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id}>
              <Cell>
                <div className="leading-[1.32]">
                  <div className="font-medium">{title(entry)}</div>
                  <div className="text-[12px] text-ink-faint">
                    {[scopeWords(entry), periodWords(entry)].join(' · ')}
                  </div>
                </div>
              </Cell>
              <Cell>
                {entry.state === 'waiting' ? (
                  <Status tone="waiting">{myDelegationWords.waiting}</Status>
                ) : (
                  <DelegationStateStatus state={entry.state} />
                )}
              </Cell>
              <Cell align="right">{action(entry)}</Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {signing === null ? null : (
        <SignDialog
          id={signing}
          onClose={() => {
            setSigning(null)
          }}
        />
      )}
    </>
  )
}
