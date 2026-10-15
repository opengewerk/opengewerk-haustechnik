import type { ServiceReportLine } from '@opengewerk/haustechnik-domain'
import { Panel, Status } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { FactList } from '@opengewerk/platform-web/office'
import { Check } from 'lucide-react'

import { usePdf } from './pdf-button.js'

/** The words of the service report on the page of a work order (#324). */
export const serviceReportWords = {
  title: 'Leistungsnachweis',
  none: 'Noch keiner. Den Leistungsnachweis unterschreibt der Auftraggeber vor Ort, bevor der Auftrag abgeschlossen wird.',
  counts: 'Gilt',
  client: 'Auftraggeber',
  signed: 'Unterschrieben',
  signedOn: (day: string) => `am ${day}, mit Schriftzug`,
  taken: 'Aufgenommen',
  takenOn: (name: string) => `auf dem Gerät von ${name}`,
  voided: (day: string) => `gilt nicht mehr, Auftrag am ${day} zurückgewiesen`,
} as const

/**
 * The service reports of a work order on its page, the board "Auftrag mit
 * Abnahme": the one that counts with its mark, those a rejection made
 * invalid with the day of it, each with its PDF. Who sees the order sees
 * its reports; no right of its own.
 */
export function ServiceReportsPanel({
  reports,
  number,
}: {
  readonly reports: readonly ServiceReportLine[]
  readonly number: string | null
}) {
  const counting = reports.find((report) => report.valid)

  return (
    <Panel
      title={serviceReportWords.title}
      action={
        counting === undefined ? undefined : (
          <Status tone="done" icon={Check}>
            {serviceReportWords.counts}
          </Status>
        )
      }
    >
      {reports.length === 0 ? (
        <p className="text-[13px] leading-[1.45] text-ink-muted">{serviceReportWords.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...reports].reverse().map((report) => (
            <ReportLine key={report.id} report={report} number={number} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ReportLine({
  report,
  number,
}: {
  readonly report: ServiceReportLine
  readonly number: string | null
}) {
  const pdf = usePdf(
    `/service-reports/${report.id}/pdf`,
    ['Leistungsnachweis', number].filter(Boolean).join(' '),
  )

  return (
    <li className="flex flex-col gap-2.5 border-b border-row pb-3 last:border-b-0 last:pb-0">
      <FactList
        keyWidth={120}
        facts={[
          { label: serviceReportWords.client, value: report.clientName },
          {
            label: serviceReportWords.signed,
            value: serviceReportWords.signedOn(date(report.signedAt)),
          },
          { label: serviceReportWords.taken, value: serviceReportWords.takenOn(report.holder) },
        ]}
      />
      {report.valid || report.voidedAt === null ? null : (
        <p className="text-[13px] font-semibold text-conflict">
          {serviceReportWords.voided(date(report.voidedAt))}
        </p>
      )}
      <div>{pdf.button}</div>
      {pdf.trouble}
    </li>
  )
}
