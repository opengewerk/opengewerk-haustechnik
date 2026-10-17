import type { SignedPrint } from '@opengewerk/haustechnik-domain'
import { Button, Dialog, DialogActions, Panel } from '@opengewerk/platform-web'
import { prepareVersion } from '@opengewerk/platform-web/attachments'
import { fileSize, moment } from '@opengewerk/platform-web/format'
import { refusalFor, useSync } from '@opengewerk/platform-web/sync'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Printer, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { makeAt } from '../sync/made-at.js'

export const signedPrintWords = {
  title: 'Höher signiertes PDF',
  none: 'Keins abgelegt. Wo eine Vorschrift mehr verlangt, wird das PDF dieses Nachweises außerhalb signiert und hier abgelegt; der Nachweis ändert sich dadurch nicht.',
  file: 'Ablegen',
  open: 'Öffnen',
  signer: (print: SignedPrint) => `Signiert von ${print.signer}`,
  about: (print: SignedPrint) =>
    [
      `Zertifikat von ${print.issuer}`,
      print.signedAt === null ? null : `signiert am ${moment(print.signedAt)}`,
      `abgelegt am ${moment(print.filedAt)} von ${print.filedBy}`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
  checked:
    'Die Signatur deckt das ganze PDF dieses Nachweises und passt zum Zertifikat darin. Ob das Zertifikat einer Vertrauensliste angehört, prüft die Anwendung nicht.',
  dialog: 'Signiertes PDF ablegen',
  steps:
    '1. Das PDF dieses Nachweises öffnen und speichern. 2. Außerhalb signieren, etwa mit einer qualifizierten elektronischen Signatur. 3. Die signierte Datei hier ablegen.',
  field: 'Signiertes PDF',
  noFile: 'Noch keine Datei gewählt.',
  choose: 'Datei wählen',
  other: 'Andere Datei',
  taken:
    'Angenommen wird nur das PDF dieses Nachweises mit einer Signatur, die das ganze Dokument deckt und zu ihrem Zertifikat passt. Der Nachweis selbst ändert sich nicht.',
  cancel: 'Abbrechen',
  working: 'Einen Moment',
  missing: 'Bitte das signierte PDF wählen.',
} as const

/** Where a PDF with a higher signature filed at an evidence is handed out (#341). */
export function signedPrintAddress(evidenceId: string, printId: string): string {
  return `/evidence/${encodeURIComponent(evidenceId)}/signed-prints/${encodeURIComponent(printId)}`
}

/**
 * The card of the PDFs of an evidence with a higher signature, signed outside
 * (#341, the boards "Nachweis mit höher signiertem PDF" and "Signiertes PDF
 * ablegen"): who signed and who issued the certificate, as the file names
 * them, and for whoever enters evidence the way to file one.
 */
export function SignedPrintsCard({
  evidenceId,
  prints,
  mayFile,
}: {
  readonly evidenceId: string
  readonly prints: readonly SignedPrint[]
  readonly mayFile: boolean
}) {
  const [filing, setFiling] = useState(false)

  return (
    <Panel
      title={signedPrintWords.title}
      {...(mayFile
        ? {
            action: (
              <Button
                size="small"
                icon={Upload}
                onClick={() => {
                  setFiling(true)
                }}
              >
                {signedPrintWords.file}
              </Button>
            ),
          }
        : {})}
    >
      {prints.length === 0 ? (
        <p className="text-[12px] leading-[1.45] text-ink-muted">{signedPrintWords.none}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col gap-2.5">
            {prints.map((print) => (
              <li key={print.id} className="flex items-center gap-3">
                <FileText
                  size={22}
                  strokeWidth={1.9}
                  aria-hidden="true"
                  className="shrink-0 text-ink-muted"
                />
                <div className="min-w-0 grow leading-[1.4]">
                  <div className="text-[14px] font-medium [overflow-wrap:anywhere]">
                    {signedPrintWords.signer(print)}
                  </div>
                  <div className="text-[12px] text-ink-faint [overflow-wrap:anywhere]">
                    {signedPrintWords.about(print)}
                  </div>
                </div>
                <a
                  href={signedPrintAddress(evidenceId, print.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2.5 py-1 text-[13px] text-ink"
                >
                  <Printer size={14} aria-hidden="true" />
                  {signedPrintWords.open}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-[12px] leading-[1.45] text-ink-muted">{signedPrintWords.checked}</p>
        </div>
      )}
      {filing ? (
        <FileSigned
          evidenceId={evidenceId}
          onClose={() => {
            setFiling(false)
          }}
        />
      ) : null}
    </Panel>
  )
}

/** The dialog to file one: the three steps, the file, and what is checked. */
function FileSigned({
  evidenceId,
  onClose,
}: {
  readonly evidenceId: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function file_() {
    if (file === null) {
      setTrouble(signedPrintWords.missing)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      // The signed file stays as it is: its bytes are what the signature covers.
      const prepared = await prepareVersion(client, file, { keepOriginal: true })

      if ('problem' in prepared) {
        setTrouble(prepared.problem)

        return
      }

      // The bytes go up ahead of the filing, which names them.
      await client.synchronise()

      const made = await makeAt(client, `/evidence/${evidenceId}/signed-prints`, {
        sha256: prepared.sha256,
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      await queries.invalidateQueries({ queryKey: ['evidence', 'page', evidenceId] })
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title={signedPrintWords.dialog} width={600} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void file_()
        }}
      >
        <p className="text-[14px] leading-[1.5]">{signedPrintWords.steps}</p>
        <input
          ref={picker}
          type="file"
          accept="application/pdf"
          className="sr-only"
          aria-label={signedPrintWords.field}
          tabIndex={-1}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setTrouble(null)
            event.target.value = ''
          }}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink max-lg:text-[15px]">
            {signedPrintWords.field}
          </span>
          <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-dashed border-line-strong bg-surface-sunken px-3 py-2.5">
            <FileText
              size={22}
              strokeWidth={1.9}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
            <div className="min-w-0 grow leading-[1.35]">
              {file === null ? (
                <span className="text-[14px] text-ink-muted">{signedPrintWords.noFile}</span>
              ) : (
                <>
                  <div className="text-[14px] font-medium [overflow-wrap:anywhere]">
                    {file.name}
                  </div>
                  <div className="text-[12px] text-ink-faint">{fileSize(file.size)}</div>
                </>
              )}
            </div>
            <Button
              type="button"
              size="small"
              icon={Upload}
              disabled={working}
              onClick={() => picker.current?.click()}
            >
              {file === null ? signedPrintWords.choose : signedPrintWords.other}
            </Button>
          </div>
        </div>
        <p className="text-[12px] leading-[1.45] text-ink-muted">{signedPrintWords.taken}</p>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            {signedPrintWords.cancel}
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? signedPrintWords.working : signedPrintWords.file}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
