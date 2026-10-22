import { type QualificationEntry, qualificationStandingLabel } from '@opengewerk/haustechnik-domain'
import { Cell, Column, Status, TablePanel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'

import { usePdf } from './pdf-button.js'
import { certificateAddress, myQualificationsQuery } from './qualification-addresses.js'

/**
 * "Ihre Qualifikationen" under "Konto" (#337, 4.3 of the concept): what the
 * person signed in holds, until when, how it stands, and the certificate.
 * Nothing for somebody of whom nothing is entered.
 */

export const myQualificationWords = {
  note: 'Eingetragen von der Leitung. Stimmt etwas nicht, wenden Sie sich an sie.',
} as const

function Certificate({ entry }: { readonly entry: QualificationEntry }) {
  const file = usePdf(
    certificateAddress(entry.id),
    `Nachweis ${entry.kind.label}`,
    'Nachweis',
    FileText,
  )

  return (
    <div className="flex flex-col items-end gap-1">
      {file.button}
      {file.trouble}
    </div>
  )
}

const tone = { valid: 'done', expiring: 'waiting', expired: 'conflict' } as const

/** The qualifications of the person signed in: their own, which no right opens or closes (#543). */
export function MyQualificationsCard() {
  const mine = useQuery(myQualificationsQuery)
  const rows = mine.data?.qualifications ?? []

  if (rows.length === 0) {
    return null
  }

  const until = (entry: QualificationEntry) =>
    entry.validUntil === null ? 'ohne Ablauf' : date(entry.validUntil)

  return (
    <TablePanel
      title="Ihre Qualifikationen"
      caption="Ihre Qualifikationen mit gültig bis und Stand"
      grow={false}
      note={myQualificationWords.note}
      cards={rows.map((entry) => ({
        key: entry.id,
        title: entry.kind.label,
        sub: [entry.kind.origin, until(entry)].join(' · '),
        right: entry.hasCertificate ? (
          <Certificate entry={entry} />
        ) : (
          <Status tone={tone[entry.standing]}>{qualificationStandingLabel[entry.standing]}</Status>
        ),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[220px]">Qualifikation</Column>
          <Column className="w-[130px] min-w-[110px]">Gültig bis</Column>
          <Column className="w-[160px] min-w-[130px]">Stand</Column>
          <Column className="w-[140px] min-w-[120px]">
            <span className="sr-only">Nachweis</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => (
          <tr key={entry.id}>
            <Cell>
              <div className="leading-[1.32]">
                <div className="font-medium">{entry.kind.label}</div>
                <div className="text-[12px] text-ink-faint">{entry.kind.origin}</div>
              </div>
            </Cell>
            <Cell>{until(entry)}</Cell>
            <Cell>
              <Status tone={tone[entry.standing]}>
                {qualificationStandingLabel[entry.standing]}
              </Status>
            </Cell>
            <Cell align="right">{entry.hasCertificate ? <Certificate entry={entry} /> : null}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
