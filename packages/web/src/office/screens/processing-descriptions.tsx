import {
  changedInWords,
  type ProcessingDescriptions,
  type ProcessingVersion,
  processingWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { date, moment } from '@opengewerk/platform-web/format'
import { NoteBox, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText } from 'lucide-react'
import { useState } from 'react'

import { fetchPdf, openPdf } from '../../app/prints.js'
import { PrivacyDocumentsPanels } from './privacy-documents.js'
import { SubjectAccessPanel } from './subject-access.js'

/** What the screen says beyond the words it shares with the PDF. */
export const processingScreenWords = {
  made: 'Erzeugt',
  by: 'Von',
  holdsFor: 'Anwendung',
  changed: 'Gegenüber der vorherigen',
  caption:
    'Die erzeugten Verfahrensbeschreibungen, mit Tag, wer sie erzeugt hat, und was sich geändert hat',
  pdf: 'PDF',
  nobody: 'Unbekanntes Konto',
  working: 'Wird erzeugt.',
  loading: 'Wird geladen.',
  failed:
    'Die Verfahrensbeschreibungen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  offline: 'Ohne Verbindung zum Server gibt es kein PDF.',
} as const

const descriptionsKey = ['settings', 'processing-descriptions'] as const

const descriptionsQuery = {
  queryKey: descriptionsKey,
  queryFn: () => request<ProcessingDescriptions>('/settings/processing-descriptions'),
} as const

/**
 * "Einstellungen", "Datenschutz", the boards "Datenschutz: die
 * Verfahrensbeschreibung und ihre erzeugten Fassungen" and "Datenschutz: noch
 * keine Fassung erzeugt" (#357): what the description says about this
 * operator now, a description made now, and every one made, each with its
 * PDF. Only the Leitung comes here, with "Auskunft, Verfahrensbeschreibung
 * und Verzeichnis erzeugen".
 */
export function ProcessingDescriptionsScreen() {
  const read = useQuery({
    ...descriptionsQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  return (
    <SettingsPage active="datenschutz" title={processingWords.title} sub={processingWords.about}>
      {read.data === undefined ? (
        <SettingsText muted>
          {read.isError ? processingScreenWords.failed : processingScreenWords.loading}
        </SettingsText>
      ) : (
        <>
          <DescriptionPanel read={read.data} />
          <Versions versions={read.data.versions} />
        </>
      )}
      <NoteBox>{processingWords.repository}</NoteBox>
      <PrivacyDocumentsPanels />
      <SubjectAccessPanel />
    </SettingsPage>
  )
}

/** What the description says about the operator now, and the button that makes one. */
function DescriptionPanel({ read }: { readonly read: ProcessingDescriptions }) {
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [made, setMade] = useState(false)

  async function make() {
    setWorking(true)
    setTrouble(null)
    setMade(false)

    try {
      await request<ProcessingVersion>('/settings/processing-descriptions', { method: 'POST' })
      await queries.invalidateQueries({ queryKey: descriptionsKey })
      setMade(true)
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : processingScreenWords.offline)
    } finally {
      setWorking(false)
    }
  }

  const changed = read.changedSinceNewest

  return (
    <Panel
      title={processingWords.card}
      roomy
      action={
        <Button
          tone="primary"
          icon={FileText}
          disabled={working}
          onClick={() => {
            void make()
          }}
        >
          {processingWords.make}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-[1.5]">{processingWords.explanation}</p>
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 text-[13px] max-sm:grid-cols-1">
          {read.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-ink-muted max-sm:mt-1">{fact.label}</dt>
              <dd className="m-0">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          {changed === null ? (
            <Status tone="neutral">{processingWords.noneYet}</Status>
          ) : changed.length === 0 ? (
            <Status tone="done">{processingWords.unchanged}</Status>
          ) : (
            <Status tone="waiting">{processingWords.changedSince(changed)}</Status>
          )}
          {working ? (
            <span role="status" className="text-[13px] text-ink-muted">
              {processingScreenWords.working}
            </span>
          ) : made ? (
            <span role="status" className="text-[13px] text-done">
              {processingWords.made}
            </span>
          ) : null}
        </div>
        {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
      </div>
    </Panel>
  )
}

/** Every description made, newest first, each with its PDF. */
function Versions({ versions }: { readonly versions: readonly ProcessingVersion[] }) {
  if (versions.length === 0) {
    return (
      <Panel title={processingWords.versions}>
        <p className="text-[14px] text-ink-muted">{processingWords.versionsEmpty}</p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title={processingWords.versions}
      caption={processingScreenWords.caption}
      cards={versions.map((version) => ({
        key: version.id,
        title: moment(version.madeAt),
        sub: [
          version.madeBy ?? processingScreenWords.nobody,
          version.holdsFor ?? '',
          changedInWords(version.changed),
        ]
          .filter(Boolean)
          .join(' · '),
        right: <PdfButton version={version} />,
      }))}
      note={processingWords.versionsNote}
    >
      <thead>
        <tr>
          <Column className="w-[170px]">{processingScreenWords.made}</Column>
          <Column className="w-[170px]">{processingScreenWords.by}</Column>
          <Column className="w-[100px]">{processingScreenWords.holdsFor}</Column>
          <Column>{processingScreenWords.changed}</Column>
          <Column className="w-[110px]">
            <span className="sr-only">{processingScreenWords.pdf}</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {versions.map((version) => (
          <tr key={version.id}>
            <Cell>{moment(version.madeAt)}</Cell>
            <Cell>{version.madeBy ?? processingScreenWords.nobody}</Cell>
            <Cell>{version.holdsFor ?? ''}</Cell>
            <Cell>
              <span className={version.changed === null ? 'text-ink-muted' : undefined}>
                {changedInWords(version.changed)}
              </span>
            </Cell>
            <Cell className="text-right">
              <PdfButton version={version} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The PDF of one description, fetched and opened in a tab of its own. */
function PdfButton({ version }: { readonly version: ProcessingVersion }) {
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const day = date(version.madeAt)

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="small"
        icon={Download}
        disabled={working}
        aria-label={processingWords.pdfOf(day)}
        onClick={() => {
          setWorking(true)
          setTrouble(null)
          fetchPdf(`/settings/processing-descriptions/${version.id}/pdf`)
            .then((file) => {
              openPdf(file, `Verfahrensbeschreibung ${day}`)
            })
            .catch((error: unknown) => {
              setTrouble(
                error instanceof RequestRefused ? error.message : processingScreenWords.offline,
              )
            })
            .finally(() => {
              setWorking(false)
            })
        }}
      >
        {processingScreenWords.pdf}
      </Button>
      {trouble === null ? null : (
        <span role="alert" className="text-[12px] text-conflict">
          {trouble}
        </span>
      )}
    </span>
  )
}
