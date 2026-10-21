import {
  changedInWords,
  type PrivacyDocumentKind,
  type PrivacyDocuments,
  type PrivacyDocumentVersion,
  privacyDocumentWords,
  processingWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { date, moment } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Download, FileText, Pencil } from 'lucide-react'
import { useState } from 'react'

import { fetchPdf, savePdf } from '../../app/prints.js'
import { processingScreenWords } from './processing-descriptions.js'

/** What each card says over its facts (#358), in the words of the board "Datenschutz". */
const explanations: Readonly<Record<PrivacyDocumentKind, string>> = {
  record:
    'Nach Art. 30 DSGVO: je Tätigkeit Zweck, Rechtsgrundlage, betroffene Personen, Daten, Empfänger und Löschung. Betroffene und Daten kennt die Anwendung; Zweck und Rechtsgrundlage schlägt sie vor, bis die Leitung sie bestätigt oder ändert.',
  measures:
    'Anlage 1 zum Vertrag zur Auftragsverarbeitung. Teil A sagt, was die Anwendung mitbringt, und ist auf jeder Instanz gleich; Teil B und die Unterauftragsverarbeiter trägt die Verwaltung der Instanz ein.',
  deletion:
    'Welche Daten die Anwendung wann löscht oder leert und was sie aufbewahrt, aus ihren eigenen Regeln und dem, was bei diesem Betreiber eingestellt ist.',
}

export const privacyScreenWords = {
  documents: 'Erzeugte Dokumente',
  document: 'Dokument',
  caption:
    'Die erzeugten Dokumente zum Datenschutz, mit Tag, wer sie erzeugt hat, und was sich geändert hat',
  documentsEmpty: 'Noch keine. Jede erzeugte Fassung bleibt hier mit ihrem Tag.',
  documentsNote: 'Jede Fassung bleibt mit ihrem Tag. Erzeugen und ansehen kann nur die Leitung.',
  keepRecord: 'Angaben pflegen',
  partBMissing:
    'Die Verwaltung der Instanz hat Teil B noch nicht ausgefüllt. Das Dokument lässt sich trotzdem erzeugen und sagt dann, dass Teil B fehlt.',
  pdfOf: (title: string, day: string) => `${title} vom ${day} als PDF`,
  failed:
    'Die Dokumente zum Datenschutz ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
} as const

export const privacyDocumentsKey = ['settings', 'privacy-documents'] as const

/**
 * The three documents of the operator on "Einstellungen", "Datenschutz" (#358),
 * the cards of the boards "Datenschutz" after the description of the
 * processing: what each says of the operator now, a document made now, and the
 * list of every one made, each with its PDF. The record has a page of its own
 * for what the Leitung writes, "Angaben pflegen".
 */
export function PrivacyDocumentsPanels() {
  const read = useQuery({
    queryKey: privacyDocumentsKey,
    queryFn: () => request<PrivacyDocuments>('/settings/privacy-documents'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  if (read.data === undefined) {
    return (
      <p className="text-[14px] text-ink-muted">
        {read.isError ? privacyScreenWords.failed : processingScreenWords.loading}
      </p>
    )
  }

  return (
    <>
      {read.data.kinds.map((kind) => (
        <DocumentPanel key={kind.kind} read={kind} />
      ))}
      <Documents versions={read.data.versions} />
    </>
  )
}

function DocumentPanel({ read }: { readonly read: PrivacyDocuments['kinds'][number] }) {
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [made, setMade] = useState(false)
  const words = privacyDocumentWords[read.kind]

  async function make() {
    setWorking(true)
    setTrouble(null)
    setMade(false)

    try {
      await request<PrivacyDocumentVersion>(`/settings/privacy-documents/${read.kind}`, {
        method: 'POST',
      })
      await queries.invalidateQueries({ queryKey: privacyDocumentsKey })
      setMade(true)
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : processingScreenWords.offline)
    } finally {
      setWorking(false)
    }
  }

  const changed = read.changedSinceNewest
  const partBMissing =
    read.kind === 'measures' &&
    read.facts.some((fact) => fact.label === 'Teil B' && fact.value === 'noch nicht ausgefüllt')

  return (
    <Panel
      title={words.title}
      roomy
      action={
        <span className="flex flex-wrap gap-2">
          {read.kind === 'record' ? (
            <Button
              icon={Pencil}
              onClick={() => {
                void navigate({ to: '/einstellungen/datenschutz/verzeichnis' })
              }}
            >
              {privacyScreenWords.keepRecord}
            </Button>
          ) : null}
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
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-[1.5]">{explanations[read.kind]}</p>
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 text-[13px] max-sm:grid-cols-1">
          {read.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-ink-muted max-sm:mt-1">{fact.label}</dt>
              <dd className="m-0">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {partBMissing ? <NoteBox tone="waiting">{privacyScreenWords.partBMissing}</NoteBox> : null}
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

/** Every document made, newest first, each with its PDF. */
function Documents({ versions }: { readonly versions: readonly PrivacyDocumentVersion[] }) {
  if (versions.length === 0) {
    return (
      <Panel title={privacyScreenWords.documents}>
        <p className="text-[14px] text-ink-muted">{privacyScreenWords.documentsEmpty}</p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title={privacyScreenWords.documents}
      caption={privacyScreenWords.caption}
      cards={versions.map((version) => ({
        key: version.id,
        title: `${privacyDocumentWords[version.kind].short}, ${moment(version.madeAt)}`,
        sub: [
          version.madeBy ?? processingScreenWords.nobody,
          version.holdsFor ?? '',
          changedInWords(version.changed),
        ]
          .filter(Boolean)
          .join(' · '),
        right: <PdfButton version={version} />,
      }))}
      note={privacyScreenWords.documentsNote}
    >
      <thead>
        <tr>
          <Column className="w-[130px]">{privacyScreenWords.document}</Column>
          <Column className="w-[150px]">{processingScreenWords.made}</Column>
          <Column className="w-[140px]">{processingScreenWords.by}</Column>
          <Column className="w-[96px]">{processingScreenWords.holdsFor}</Column>
          <Column>{processingScreenWords.changed}</Column>
          <Column className="w-[100px]">
            <span className="sr-only">{processingScreenWords.pdf}</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {versions.map((version) => (
          <tr key={version.id}>
            <Cell>{privacyDocumentWords[version.kind].short}</Cell>
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

function PdfButton({ version }: { readonly version: PrivacyDocumentVersion }) {
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const day = date(version.madeAt)
  const { short } = privacyDocumentWords[version.kind]

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="small"
        icon={Download}
        disabled={working}
        aria-label={privacyScreenWords.pdfOf(short, day)}
        onClick={() => {
          setWorking(true)
          setTrouble(null)
          fetchPdf(`/settings/privacy-documents/${version.id}/pdf`)
            .then((file) => {
              savePdf(file, `${short} ${day}`)
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
