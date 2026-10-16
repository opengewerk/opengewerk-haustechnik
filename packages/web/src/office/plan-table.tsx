import { addDays, type IsoDate } from '@opengewerk/haustechnik-domain'
import { Button, Choice, Dialog, DialogActions, Field } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { requestFile, RequestRefused } from '@opengewerk/platform-web/sync'
import { Download } from 'lucide-react'
import { useState } from 'react'

/**
 * "Als Tabelle" at a plan of rounds (#344, the board "Die Rundgänge eines
 * Plans über einen Zeitraum als Tabelle"): every round of the plan signed in
 * a period, a row a point, as a workbook or as text with semicolons, made by
 * the server from the frozen state of each. Without names and times of day.
 */
export const planTableWords = {
  title: 'Rundgänge als Tabelle',
  explained:
    'Jeder abgeschlossene Rundgang des Plans, dessen Unterschrift in den Zeitraum fällt, je Punkt eine Zeile: Tag, Kapitel, Punkt, Antwort, Grenzwert und Bemerkung. Ohne Namen und Uhrzeiten; wer unterschrieben hat, steht im PDF des einzelnen Rundgangs. Höchstens ein Jahr.',
  offline: 'Ohne Verbindung zum Server gibt es keine Tabelle.',
} as const

const formats = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
] as const

type Format = (typeof formats)[number]['value']

const accepts: Readonly<Record<Format, string>> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
}

/** Hands a file to the browser to keep, as the table of a list does. */
function save(content: Blob, name: string): void {
  const address = URL.createObjectURL(content)
  const link = document.createElement('a')

  link.href = address
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(address)
  }, 0)
}

/** The first and the last day of the month before the one of a day: the period a month's table is mostly asked for. */
function lastMonth(day: IsoDate): { readonly from: IsoDate; readonly to: IsoDate } {
  const first = `${day.slice(0, 8)}01` as IsoDate
  const to = addDays(first, -1)

  return { from: `${to.slice(0, 8)}01` as IsoDate, to }
}

export function PlanTableDialog({
  planId,
  title,
  onClose,
}: {
  readonly planId: string
  readonly title: string
  readonly onClose: () => void
}) {
  const suggested = lastMonth(today() as IsoDate)
  const [from, setFrom] = useState<string>(suggested.from)
  const [to, setTo] = useState<string>(suggested.to)
  const [format, setFormat] = useState<Format>('xlsx')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  function send() {
    setWorking(true)
    setTrouble(null)

    const query = new URLSearchParams({ from, to, format })

    requestFile(
      `/round-plans/${encodeURIComponent(planId)}/table?${query.toString()}`,
      accepts[format],
    )
      .then((file) => {
        save(file.content, file.name ?? `Rundgänge.${format}`)
        onClose()
      })
      .catch((error: unknown) => {
        setTrouble(error instanceof RequestRefused ? error.message : planTableWords.offline)
      })
      .finally(() => {
        setWorking(false)
      })
  }

  return (
    <Dialog title={planTableWords.title} sub={title} width={520} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Von"
            type="date"
            required
            starred
            value={from}
            onChange={(event) => {
              setFrom(event.target.value)
            }}
          />
          <Field
            label="Bis"
            type="date"
            required
            starred
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
            }}
          />
        </div>
        <Choice<Format>
          label="Format"
          value={format}
          onChange={setFormat}
          options={formats.map((each) => ({ value: each.value, label: each.label }))}
        />
        <p className="text-[12px] text-ink-faint">{planTableWords.explained}</p>
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
