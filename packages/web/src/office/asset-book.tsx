import { Button, Choice, Dialog, DialogActions } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { requestFile, RequestRefused } from '@opengewerk/platform-web/sync'
import { Download } from 'lucide-react'
import { useState } from 'react'

import { accepts, type Format, formats, save, Tick } from './evidence-register.js'

/**
 * The book of an asset in its file (#437, the board "Anlagenakte:
 * Anlagenbuch ausgeben"): all its evidence in the order of time with its
 * life cycle, as a PDF or a table, for the day it is made, under the name the
 * package of its kind gives it. Whoever reads the asset and its evidence
 * makes it; the count says what it holds before it is made.
 */
export const assetBookDialogWords = {
  sub: 'alle Nachweise und der Lebenszyklus in zeitlicher Folge',
  attach: 'Nachweise und Belege anhängen',
  attachSub:
    'Nur im PDF: hinter dem Buch in einem Dokument, jeder Eintrag mit der Seite seines Nachweises.',
} as const

export function AssetBookDialog({
  assetId,
  asset,
  title,
  count,
  onClose,
}: {
  readonly assetId: string
  /** The asset by its number and name, "AN-00057 Trinkwassererwärmer". */
  readonly asset: string
  /** "Anlagenbuch", or the name the package of its kind gives the book. */
  readonly title: string
  /** What the book holds, in words; none while the evidence is not read yet. */
  readonly count: string | null
  readonly onClose: () => void
}) {
  const [format, setFormat] = useState<Format>('pdf')
  const [attach, setAttach] = useState(true)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  function send() {
    setWorking(true)
    setTrouble(null)

    const asked = new URLSearchParams()

    if (format !== 'pdf') {
      asked.set('format', format)
    } else if (attach) {
      asked.set('attach', '1')
    }

    const query = asked.toString()
    const address = `/assets/${assetId}/book/${format === 'pdf' ? 'pdf' : 'table'}`

    requestFile(`${address}${query === '' ? '' : `?${query}`}`, accepts[format])
      .then((file) => {
        save(file.content, file.name ?? `${title}.${format}`)
        onClose()
      })
      .catch((error: unknown) => {
        setTrouble(
          error instanceof RequestRefused
            ? error.message
            : `Ohne Verbindung zum Server gibt es kein ${title}.`,
        )
      })
      .finally(() => {
        setWorking(false)
      })
  }

  return (
    <Dialog
      title={title}
      sub={`${asset}: ${assetBookDialogWords.sub}`}
      width={600}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {count === null ? null : <NoteBox>{count}</NoteBox>}
        <Choice<Format>
          label="Format"
          value={format}
          onChange={setFormat}
          options={formats.map((each) => ({ value: each.value, label: each.label }))}
        />
        <Tick
          checked={format === 'pdf' && attach}
          disabled={format !== 'pdf'}
          label={assetBookDialogWords.attach}
          sub={assetBookDialogWords.attachSub}
          onChange={setAttach}
        />
        <p className="text-[12px] text-ink-faint">
          Gilt für heute, den {date(today())}, und nennt diesen Tag. Ein ersetzter oder für ungültig
          erklärter Nachweis bleibt darin und ist so gekennzeichnet, einer aus dem Altbestand
          ebenso. Eine Komponente hat ihr eigenes Buch.
        </p>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Download} disabled={working}>
            {working ? 'Einen Moment' : 'Ausgeben'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
