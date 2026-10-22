import {
  type AssetKind,
  type DocumentKind,
  documentKindLabel,
  expectedDocumentsAt,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { useVersions } from '@opengewerk/platform-web/attachments'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecords } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { Check, TriangleAlert, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'

import { type DocumentPlace, documentsAt, newestFirst, withAFile } from '../app/documents.js'
import { documentPlaces } from './document-addresses.js'
import { UploadDocumentDialog } from './documents.js'
import { factLink } from './links.js'

/** What the card says, in the words of the board "Anlagenakte mit ihren Unterlagen aus dem Paket" (#347). */
export const expectedWords = {
  title: 'Unterlagen',
  count: (there: number, all: number) => `${String(there)} von ${String(all)}`,
  required: (source: string | null) => (source === null ? 'verlangt' : `verlangt, ${source}`),
  recommended: 'empfohlen',
  missing: 'Fehlt',
  upload: 'Hochladen',
  /** What the package of the kind names, or, without one, the kind of the operator's own (#62). */
  note: (packageTitle: string | null) =>
    `${packageTitle === null ? 'Was diese eigene Anlagenart nennt' : `Was das Paket ${packageTitle} für diese Anlagenart nennt`}. Vorhanden ist eine Unterlage, wenn ein Dokument ihrer Art an der Anlage liegt.`,
} as const

/** A document of the asset as the question needs it: its record and its kind. */
interface Filed {
  readonly record: RecordState
  readonly kind: DocumentKind | null
}

/**
 * The documents the kind of an asset expects, from its package, above the
 * documents themselves (#347, 4.10): each with the document of its kind at
 * the asset, or "Fehlt" and the way to file one of that kind. Whether one is
 * there says the file, never a box ticked by hand.
 *
 * Nothing stands here for a kind that expects nothing, nor for whoever does
 * not read documents.
 */
export function ExpectedDocumentsCard({
  kind,
  packageTitle,
  place,
  at,
}: {
  readonly kind: Pick<AssetKind, 'expectedDocuments'> | null
  /** Null for a kind of the operator's own, which no package names. */
  readonly packageTitle: string | null
  readonly place: DocumentPlace
  /** The asset in words, for the dialog: "AN-00012 Elektrische Anlage Halle 1". */
  readonly at: string
}) {
  const reads = useRight('document.read')
  const files = useRight('document.record')
  const documents = useRecords('attachments')
  const versions = useVersions()
  const [filing, setFiling] = useState<DocumentKind | null>(null)

  const states = useMemo(
    () =>
      expectedDocumentsAt<Filed>(
        kind,
        newestFirst(withAFile(documentsAt(documents, place), versions), versions).map((record) => ({
          record,
          kind: (maybeText(record, 'kind') ?? null) as DocumentKind | null,
        })),
      ),
    [kind, documents, versions, place],
  )

  if (!reads || states.length === 0) {
    return null
  }

  const there = states.filter((state) => state.document !== null).length

  return (
    <Panel
      title={expectedWords.title}
      action={
        <span className="text-[13px] text-ink-muted">
          {expectedWords.count(there, states.length)}
        </span>
      }
    >
      <ul className="flex flex-col gap-2.5" aria-label={expectedWords.title}>
        {states.map(({ expected, document }) => (
          <li key={expected.key} className="flex items-start gap-2">
            {document === null ? (
              <TriangleAlert
                size={15}
                strokeWidth={2.2}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-conflict"
              />
            ) : (
              <Check
                size={15}
                strokeWidth={2.4}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-done"
              />
            )}
            <div className="min-w-0 grow leading-[1.35]">
              <div className="font-medium">{expected.label}</div>
              <div className="text-[12px] text-ink-faint">
                {documentKindLabel[expected.kind]} ·{' '}
                {expected.demand === 'required'
                  ? expectedWords.required(expected.source)
                  : expectedWords.recommended}
              </div>
              <div className="mt-1">
                {document === null ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-conflict">{expectedWords.missing}</span>
                    <span className="grow" />
                    {files ? (
                      <Button
                        size="small"
                        icon={Upload}
                        aria-label={`${expected.label} hochladen`}
                        onClick={() => {
                          setFiling(expected.kind)
                        }}
                      >
                        {expectedWords.upload}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <Link
                    to={documentPlaces.document(String(document.record['id']))}
                    className={`${factLink} text-[13px]`}
                  >
                    {text(document.record, 'title')}
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12px] leading-[1.4] text-ink-muted">
        {expectedWords.note(packageTitle)}
      </p>
      {filing === null ? null : (
        <UploadDocumentDialog
          place={place}
          at={at}
          kind={filing}
          onClose={() => {
            setFiling(null)
          }}
        />
      )}
    </Panel>
  )
}
