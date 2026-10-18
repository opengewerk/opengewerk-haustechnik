import {
  type ImportedRecord,
  type ImportedTable,
  importKindLabel,
  type ImportReading,
  type Right,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { auditLogPath, Empty, FactList, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { importReadings } from '../import-addresses.js'
import { officePlaces } from '../place-addresses.js'

export const importPageWords = {
  title: (day: string) => `Import vom ${day}`,
  untitled: 'Import',
  loading: 'Wird geladen.',
  failed: 'Der Import ließ sich nicht laden. Er kommt vom Server, mit Verbindung.',
  noConnection: 'Ohne Verbindung. Der Import kommt vom Server.',
  onlyFor: 'Einen Import sieht nur die Leitung, wie das Änderungsprotokoll.',
  about: 'Import',
  made: 'Angelegt',
  caption: 'Was der Import angelegt hat, mit Art und Datensatz',
  note: 'Es stehen nur Datensätze in Ihren Bereichen da. Was der Import angelegt hat und inzwischen entfernt ist, steht nicht mehr da.',
  nothing:
    'Hier steht kein Datensatz. Ein Import von Fristen, Zählerständen oder Vorlagen legt keinen Ort und keine Anlage an, und was ein Import aus einer früheren Fassung angelegt hat, steht hier nicht.',
  more: 'Weitere laden',
  of: (shown: number, total: number) => `${String(shown)} von ${String(total)}`,
} as const

/** How many records the page shows at first, and how many more each press brings. */
const pageSize = 50

/** What a record is, in the words of the log, and where it opens. */
const kindOf: Readonly<Record<ImportedTable, string>> = {
  properties: 'Liegenschaft',
  buildings: 'Gebäude',
  floors: 'Geschoss',
  rooms: 'Raum',
  assets: 'Anlage',
}

const pageOf: Readonly<Record<ImportedTable, (id: string) => string>> = {
  properties: officePlaces.property,
  buildings: officePlaces.building,
  floors: officePlaces.floor,
  rooms: officePlaces.room,
  assets: officePlaces.asset,
}

const crumbs = [
  { to: '/einstellungen', label: 'Einstellungen' },
  { to: auditLogPath, label: 'Änderungsprotokoll' },
]

const refusedOnce = (count: number, error: Error) => !(error instanceof RequestRefused) && count < 2

function Shown({ children }: { readonly children: string }) {
  return (
    <Screen>
      <PageHead title={importPageWords.untitled} crumbs={crumbs} />
      <Panel>
        <Empty>{children}</Empty>
      </Panel>
    </Screen>
  )
}

/**
 * The page of an import (#174), `import_seite()` of the boards of the
 * settings: the file, its lines and what came of them, and every record it
 * made that is still there, each leading to its page. It is reached from the
 * entry of the import in the change log and from the line over the log of a
 * record it made, so whoever reads the log reads it, the Leitung.
 *
 * The server joins every record under the policies of its own table: a
 * record outside the areas of the person asking, or removed since, is not
 * listed.
 */
export function ImportScreen() {
  const { importId } = useParams({ strict: false }) as { importId: string }
  const reads = useRight('audit.read' satisfies Right)
  const [shown, setShown] = useState(pageSize)
  const page = useQuery({
    queryKey: ['imports', 'made', importId],
    queryFn: () => request<ImportReading>(importReadings.made(importId)),
    enabled: reads,
    retry: refusedOnce,
  })

  if (!reads) {
    return <Shown>{importPageWords.onlyFor}</Shown>
  }

  // Refused, the server says why, as for an import that is none of this operator's.
  if (page.data === undefined) {
    return (
      <Shown>
        {page.error instanceof RequestRefused
          ? page.error.message
          : page.isError
            ? importPageWords.failed
            : page.fetchStatus === 'paused'
              ? importPageWords.noConnection
              : importPageWords.loading}
      </Shown>
    )
  }

  const reading = page.data
  const listed: readonly ImportedRecord[] = reading.records.slice(0, shown)
  const title = (record: ImportedRecord) => (
    <Link to={pageOf[record.table](record.id)}>{record.title}</Link>
  )

  return (
    <Screen>
      <PageHead
        title={importPageWords.title(date(reading.importedOn))}
        crumbs={crumbs}
        sub={importKindLabel[reading.kind]}
      />
      <Panel>
        <div className="flex flex-col gap-2.5">
          <h2 className="font-condensed text-label font-semibold tracking-[1.1px] uppercase text-ink-faint">
            {importPageWords.about}
          </h2>
          <FactList
            facts={[
              { label: 'Datei', value: reading.fileName },
              { label: 'Zeilen', value: String(reading.lines) },
              { label: 'Ergebnis', value: reading.summary },
            ]}
          />
        </div>
      </Panel>
      {reading.records.length === 0 ? (
        <Panel>
          <Empty>{importPageWords.nothing}</Empty>
        </Panel>
      ) : (
        <TablePanel
          title={importPageWords.made}
          caption={importPageWords.caption}
          grow={false}
          note={importPageWords.note}
          cards={listed.map((record) => ({
            key: record.id,
            title: title(record),
            sub: kindOf[record.table],
          }))}
          {...(reading.records.length > pageSize
            ? {
                footer: (
                  <div className="flex items-center gap-3">
                    <span>{importPageWords.of(listed.length, reading.records.length)}</span>
                    <span className="grow" />
                    {listed.length < reading.records.length ? (
                      <Button
                        size="small"
                        onClick={() => {
                          setShown((before) => before + pageSize)
                        }}
                      >
                        {importPageWords.more}
                      </Button>
                    ) : null}
                  </div>
                ),
              }
            : {})}
        >
          <thead>
            <tr>
              <Column className="w-[140px] min-w-[120px]">Art</Column>
              <Column className="min-w-[220px]">Datensatz</Column>
            </tr>
          </thead>
          <tbody>
            {listed.map((record) => (
              <tr key={record.id}>
                <Cell>{kindOf[record.table]}</Cell>
                <Cell>{title(record)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}
