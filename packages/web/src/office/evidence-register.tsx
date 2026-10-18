import {
  byNameIn,
  type DutyRegisterFilter,
  type EvidenceRegisterCount,
  evidenceRegisterWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Choice, Dialog, DialogActions, SelectField } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Chip, NoteBox } from '@opengewerk/platform-web/office'
import {
  maybeText,
  request,
  requestFile,
  RequestRefused,
  useRecords,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Download, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useAreas } from '../session/areas.js'
import { useCatalogue } from '../sync/catalogue.js'
import { assetKindChoices } from './register-filter.js'

/**
 * "Nachweisverzeichnis" at the register of duties (#338, the board
 * "Nachweisverzeichnis ausgeben"): every duty of the assets chosen with its
 * last evidence, for an inspection or an audit, as a PDF or a table, for the
 * day it is made. The choice starts from the filter of the list, and the count
 * says what the register of duties shows under the same choice.
 */
export const evidenceRegisterDialogWords = {
  sub: 'Je Anlage ihre Pflichten mit dem letzten Nachweis, für Begehungen und Audits',
  ended: 'Beendete Pflichten aufnehmen',
  endedSub: 'Sonst steht darin, was läuft oder ruht.',
  attach: 'Nachweise und Prüfbescheinigungen anhängen',
  attachSub:
    'Nur im PDF: hinter der Liste in einem Dokument, jede Zeile mit der Seite ihres Nachweises.',
  offline: 'Ohne Verbindung zum Server gibt es kein Nachweisverzeichnis.',
} as const

export const formats = [
  { value: 'pdf', label: 'PDF' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
] as const

export type Format = (typeof formats)[number]['value']

export const accepts: Readonly<Record<Format, string>> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
}

/** Hands a file to the browser to keep, as the table of a list does. */
export function save(content: Blob, name: string): void {
  const address = URL.createObjectURL(content)
  const link = document.createElement('a')

  link.href = address
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(address)
  }, 0)
}

/** The count in words: "31 Pflichten an 18 Anlagen, davon 2 nie erfasst." */
function countWords(count: EvidenceRegisterCount): string {
  const duties = `${count.duties.toLocaleString('de-DE')} ${count.duties === 1 ? 'Pflicht' : 'Pflichten'}`
  const assets = `${count.assets.toLocaleString('de-DE')} ${count.assets === 1 ? 'Anlage' : 'Anlagen'}`

  return `${duties} an ${assets}, davon ${count.never.toLocaleString('de-DE')} nie erfasst. So viele zeigt das Pflichtenverzeichnis unter derselben Auswahl.`
}

/** A box to tick with a line under it, as the board draws "Beendete Pflichten aufnehmen". */
export function Tick({
  checked,
  disabled = false,
  label,
  sub,
  onChange,
}: {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly sub: string
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`flex items-start gap-2.5 text-[14px] leading-[1.4]${disabled ? ' opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-copper-solid disabled:cursor-not-allowed"
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <span>
        {label}
        <span className="block text-[12px] text-ink-muted">{sub}</span>
      </span>
    </label>
  )
}

export function EvidenceRegisterDialog({
  filter,
  onClose,
}: {
  readonly filter: DutyRegisterFilter
  readonly onClose: () => void
}) {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const areas = useAreas()
  const kinds = assetKindChoices(useCatalogue())
  const [propertyId, setPropertyId] = useState(filter.propertyId ?? '')
  const [buildingId, setBuildingId] = useState(filter.buildingId ?? '')
  const [areaId, setAreaId] = useState(filter.areaId ?? '')
  const [assetKinds, setAssetKinds] = useState<readonly string[]>(
    filter.assetKind === undefined ? [] : [filter.assetKind],
  )
  const [ended, setEnded] = useState(false)
  const [format, setFormat] = useState<Format>('pdf')
  const [attach, setAttach] = useState(true)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const query = useMemo(() => {
    const said = new URLSearchParams()

    if (propertyId !== '') {
      said.set('propertyId', propertyId)
    }

    if (buildingId !== '') {
      said.set('buildingId', buildingId)
    }

    if (areaId !== '') {
      said.set('areaId', areaId)
    }

    if (assetKinds.length > 0) {
      said.set('assetKinds', assetKinds.join(','))
    }

    if (ended) {
      said.set('ended', '1')
    }

    return said
  }, [propertyId, buildingId, areaId, assetKinds, ended])
  // A filter that names a building alone shows the property it stands on.
  const shownProperty =
    propertyId !== ''
      ? propertyId
      : String(buildings.find((building) => building['id'] === buildingId)?.['propertyId'] ?? '')
  const count = useQuery({
    queryKey: ['duties', 'evidence-register', query.toString()],
    queryFn: () => request<EvidenceRegisterCount>(`/duties/evidence-register?${query.toString()}`),
  })
  const byName = (records: typeof properties) =>
    records
      .map((record) => ({ value: String(record['id']), label: maybeText(record, 'name') ?? '' }))
      .sort((left, right) => byNameIn(left.label, right.label))
  const labelOf = (key: string) => kinds.find((kind) => kind.key === key)?.label ?? key

  function send() {
    setWorking(true)
    setTrouble(null)

    const address = `/duties/evidence-register/${format === 'pdf' ? 'pdf' : 'table'}`
    const asked = new URLSearchParams(query)

    if (format !== 'pdf') {
      asked.set('format', format)
    } else if (attach) {
      asked.set('attach', '1')
    }

    requestFile(`${address}?${asked.toString()}`, accepts[format])
      .then((file) => {
        save(file.content, file.name ?? `${evidenceRegisterWords.title}.${format}`)
        onClose()
      })
      .catch((error: unknown) => {
        setTrouble(
          error instanceof RequestRefused ? error.message : evidenceRegisterDialogWords.offline,
        )
      })
      .finally(() => {
        setWorking(false)
      })
  }

  return (
    <Dialog
      title={evidenceRegisterWords.title}
      sub={evidenceRegisterDialogWords.sub}
      width={640}
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
        <SelectField
          label="Liegenschaft"
          value={shownProperty}
          options={[{ value: '', label: 'Alle Liegenschaften' }, ...byName(properties)]}
          onChange={(value) => {
            setPropertyId(value)
            setBuildingId('')
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Gebäude"
            value={buildingId}
            disabled={shownProperty === ''}
            options={[
              { value: '', label: 'Alle Gebäude' },
              ...byName(buildings.filter((building) => building['propertyId'] === shownProperty)),
            ]}
            onChange={setBuildingId}
          />
          {areas.length > 1 ? (
            <SelectField
              label="Bereich"
              value={areaId}
              options={[
                { value: '', label: 'Alle Bereiche' },
                ...areas.map((area) => ({ value: area.id as string, label: area.name })),
              ]}
              onChange={setAreaId}
            />
          ) : null}
        </div>
        <div role="group" aria-label="Anlagenarten" className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            Anlagenarten
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {assetKinds.map((kind) => (
              <Chip
                key={kind}
                pressed
                onPress={() => {
                  setAssetKinds(assetKinds.filter((each) => each !== kind))
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {labelOf(kind)}
                  <X aria-hidden size={13} />
                </span>
              </Chip>
            ))}
            <div className="w-full sm:w-[240px]">
              <SelectField
                label="Anlagenart hinzufügen"
                value=""
                options={[
                  {
                    value: '',
                    label: assetKinds.length === 0 ? 'Alle Anlagenarten' : 'Hinzufügen',
                  },
                  ...kinds
                    .filter((kind) => !assetKinds.includes(kind.key))
                    .map((kind) => ({ value: kind.key, label: kind.label })),
                ]}
                onChange={(value) => {
                  if (value !== '') {
                    setAssetKinds([...assetKinds, value])
                  }
                }}
              />
            </div>
          </div>
        </div>
        {count.data === undefined ? null : <NoteBox>{countWords(count.data)}</NoteBox>}
        <Tick
          checked={ended}
          label={evidenceRegisterDialogWords.ended}
          sub={evidenceRegisterDialogWords.endedSub}
          onChange={setEnded}
        />
        <Choice<Format>
          label="Format"
          value={format}
          onChange={setFormat}
          options={formats.map((each) => ({ value: each.value, label: each.label }))}
        />
        <Tick
          checked={format === 'pdf' && attach}
          disabled={format !== 'pdf'}
          label={evidenceRegisterDialogWords.attach}
          sub={evidenceRegisterDialogWords.attachSub}
          onChange={setAttach}
        />
        <p className="text-[12px] text-ink-faint">
          Gilt für heute, den {date(today())}, und nennt diesen Tag. Ein Nachweis aus dem Altbestand
          ist als solcher gekennzeichnet, eine Pflicht ohne Nachweis steht als „
          {evidenceRegisterWords.never}“ darin. Enthalten ist nur, was Sie in Ihren Bereichen sehen.
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
