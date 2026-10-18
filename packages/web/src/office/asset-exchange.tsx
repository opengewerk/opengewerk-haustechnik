import {
  type AssetDetails,
  type AssetDuplicates,
  assetProblems,
  dutyInterval,
  exchangeProblems,
  type ExchangeStanding,
  intervalWords,
  passedDuplicates,
  sameWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Dialog, DialogActions, Field, SelectField } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, TriangleAlert } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { kindChoices } from '../app/asset-values.js'
import { useCatalogue } from '../sync/catalogue.js'
import { makeAt } from '../sync/made-at.js'
import { duplicatesRequest } from './asset-addresses.js'
import { officePlaces } from './place-addresses.js'
import { kindLabel } from './screens/assets.js'

/**
 * The exchange of an asset, `tauschen()` of the boards (4.2 of the concept,
 * #89): the old one is removed from a day on, a new one stands where it stood
 * and supplies what it supplied, with a number of its own.
 *
 * The dialog asks for the day and for what is known of the asset that comes,
 * and shows before anybody says yes what ends with the one that goes: its
 * duties, a defect nobody set right yet, an activity that is open. Nothing
 * moves to the new asset by itself. A duty the operator made himself goes
 * along when it is ticked, by whoever keeps the register of duties, and so
 * does a single component.
 *
 * Asked of the route of the server, with a connection, in one step: when a
 * part of it is refused, nothing of it stands. The file of the new asset
 * opens afterwards, where its duties wait as proposals.
 */

export const exchangeWords = {
  removed: (old: string) =>
    `${old} wird ab dem Tag des Tauschs zurückgebaut. Ihre Nachweise bleiben bei ihr.`,
  takesPlace:
    'Die neue Anlage übernimmt Standort und Versorgungsbereich und bekommt eine eigene Nummer.',
  proposed:
    'Ihre Pflichten werden neu vorgeschlagen; bis zur Bestätigung stehen sie als Vorschlag im Pflichtenverzeichnis.',
  ends: (old: string) => `Endet mit ${old}`,
  duties: (count: number) =>
    count === 1
      ? '1 Pflicht endet am Tag des Tauschs.'
      : `${String(count)} Pflichten enden am Tag des Tauschs.`,
  defects: (count: number) =>
    count === 1
      ? '1 offener Mangel gilt als behoben und wartet auf die Nachprüfung'
      : `${String(count)} offene Mängel gelten als behoben und warten auf die Nachprüfung`,
  activities: (count: number) =>
    count === 1
      ? '1 offener Vorgang wird als nicht durchgeführt geschlossen'
      : `${String(count)} offene Vorgänge werden als nicht durchgeführt geschlossen`,
  unread: 'Was mit der Anlage endet, sagt der Server, mit Verbindung. Gerade ist keine da.',
  ownDuties: 'Eigene Pflichten übernehmen',
  ownDutiesEnd: 'Eigene Pflichten',
  needsDutyRight:
    'Sie enden mit der alten Anlage. Übernehmen kann sie beim Tausch, wer das Pflichtenverzeichnis führt.',
  components: 'Komponenten mitnehmen',
  componentsStay: (old: string) =>
    `Was nicht mitgeht, bleibt unter ${old} und behält seinen Zustand.`,
  check: 'Bitte prüfen Sie die markierten Felder.',
  noAnswer:
    'Ob es die neue Anlage schon gibt, ließ sich nicht prüfen. Das beantwortet der Server, mit Verbindung.',
  elsewhere: 'eine Anlage außerhalb Ihrer Bereiche',
  isItTheSame: 'Ist es eine andere Anlage, tauschen Sie trotzdem.',
} as const

/** What an exchange would end at an asset, as the server counts it today. */
export function exchangeStandingQuery(id: string) {
  return {
    queryKey: ['assets', 'exchange', id],
    queryFn: () => request<ExchangeStanding>(`/assets/${id}/exchange`),
  } as const
}

/** Whether the file of an asset offers its exchange: once, and not for a measuring point. */
export function mayBeExchanged(
  asset: Pick<AssetDetails, 'replacedBy' | 'lifecycleState' | 'meterNumber'>,
): boolean {
  return (
    asset.replacedBy === null && asset.lifecycleState !== 'removed' && asset.meterNumber === null
  )
}

/** A group of the dialog under its name, as a form names a group of boxes. */
function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  )
}

/** A box to tick with a line under it. */
function Tick({
  label,
  sub,
  checked,
  onChange,
}: {
  readonly label: string
  readonly sub: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2.5 text-[14px] leading-[1.4]">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-copper-solid"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <span className="min-w-0">
        {label}
        {sub === '' ? null : <span className="block text-[12px] text-ink-muted">{sub}</span>}
      </span>
    </label>
  )
}

const pointList = 'list-disc pl-[18px] text-[13px] leading-[1.6]'

export function ExchangeAssetDialog({
  asset,
  onClose,
}: {
  readonly asset: AssetDetails
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const catalogue = useCatalogue()
  const keepsDuties = useRight('duty.write')
  const standing = useQuery(exchangeStandingQuery(asset.id))
  const [on, setOn] = useState<string>(today())
  const [name, setName] = useState(asset.name)
  const [kind, setKind] = useState(asset.kind)
  const [manufacturer, setManufacturer] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [components, setComponents] = useState<readonly string[]>([])
  const [duties, setDuties] = useState<readonly string[]>([])
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  /** What the server found for the serial number that was sent last: shown, and passed with a second yes. */
  const [found, setFound] = useState<{
    readonly serialNumber: string
    readonly there: AssetDuplicates
  } | null>(null)

  const old = asset.number ?? asset.name
  // A measuring point comes to the point that is there, with "Zählertausch".
  const kinds = catalogue
    ? kindChoices(catalogue).filter(
        (choice) => catalogue.assetKind(choice.value, today())?.definition.meter === null,
      )
    : []
  const kindOptions = kinds.some((choice) => choice.value === kind)
    ? kinds
    : [{ value: kind, label: kindLabel(catalogue, kind) }, ...kinds]
  const ends = standing.data
  const toggled = (chosen: readonly string[], id: string, checked: boolean) =>
    checked ? [...chosen, id] : chosen.filter((each) => each !== id)
  const named = (words: string, names: readonly string[]) =>
    names.length === 0 ? `${words}.` : `${words}: ${names.join('; ')}`

  async function exchange(decided: boolean) {
    setTrouble(null)

    const said = { kind, name, manufacturer, serialNumber }
    const wrong = { ...exchangeProblems({ on }, today()), ...assetProblems(said) }

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(exchangeWords.check)

      return
    }

    setWorking(true)

    try {
      const question = { serialNumber, mark: '' }
      let there = found?.serialNumber === serialNumber.trim() ? found.there : null

      // The new asset is asked about like every asset that is entered: one
      // with its serial number may be the same, and whoever enters it decides.
      if (!decided && serialNumber.trim() !== '') {
        let asked: AssetDuplicates

        try {
          asked = await queries.fetchQuery({
            queryKey: ['assets', 'duplicates', serialNumber.trim(), '', null],
            queryFn: () => request<AssetDuplicates>(duplicatesRequest(question, null)),
            staleTime: 0,
          })
        } catch {
          setTrouble(exchangeWords.noAnswer)

          return
        }

        there = asked
        setFound({ serialNumber: serialNumber.trim(), there: asked })

        if (asked.assets.length > 0 || asked.elsewhere.length > 0) {
          return
        }
      }

      const passed = decided && there ? passedDuplicates(question, there.assets) : []
      const result = await makeAt(client, `/assets/${asset.id}/exchange`, {
        on,
        asset: { ...said, ...(passed.length === 0 ? {} : { distinctFrom: passed }) },
        components,
        duties,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // Both files, the register and what ended with the old asset come from
      // the server: what was read of them is dropped, so that the file that
      // opens next does not show for a moment what was before.
      queries.removeQueries({ queryKey: ['assets'] })
      await Promise.all(
        ['duties', 'defects', 'activities', 'deadlines', 'overview'].map((key) =>
          queries.invalidateQueries({ queryKey: [key] }),
        ),
      )
      onClose()
      await navigate({ to: officePlaces.asset(result.id) })
    } finally {
      setWorking(false)
    }
  }

  const duplicates = found?.serialNumber === serialNumber.trim() ? found.there : null
  const asksAgain =
    duplicates !== null && (duplicates.assets.length > 0 || duplicates.elsewhere.length > 0)

  return (
    <Dialog
      title="Anlage tauschen"
      width={640}
      onClose={onClose}
      sub={[asset.number, asset.name].filter(Boolean).join(' ')}
    >
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          void exchange(false)
        }}
      >
        <div className="sm:w-[180px]">
          <Field
            label="Tag des Tauschs"
            type="date"
            required
            starred
            max={today()}
            value={on}
            problem={problems['on']}
            onChange={(event) => {
              setOn(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Neue Anlage: Bezeichnung"
            required
            starred
            value={name}
            problem={problems['name']}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
          <SelectField
            label="Anlagenart"
            required
            starred
            options={kindOptions}
            value={kind}
            problem={problems['kind']}
            onChange={setKind}
          />
          <Field
            label="Hersteller"
            value={manufacturer}
            problem={problems['manufacturer']}
            onChange={(event) => {
              setManufacturer(event.target.value)
            }}
          />
          <Field
            label="Seriennummer"
            value={serialNumber}
            problem={problems['serialNumber']}
            onChange={(event) => {
              setSerialNumber(event.target.value)
            }}
          />
        </div>
        {asksAgain ? (
          <div role="group" aria-label="Mögliche Dublette">
            <NoteBox tone="conflict" icon={TriangleAlert}>
              {duplicates.assets.map((duplicate) => (
                <span key={duplicate.id} className="block">
                  {sameWords(duplicate.same)} wie{' '}
                  {[duplicate.number, duplicate.name].filter(Boolean).join(' ')}.
                </span>
              ))}
              {duplicates.elsewhere.length > 0 ? (
                <span className="block">
                  {sameWords(duplicates.elsewhere)} wie {exchangeWords.elsewhere}.
                </span>
              ) : null}
              <span className="block">{exchangeWords.isItTheSame}</span>
            </NoteBox>
          </div>
        ) : null}
        <ul className={pointList}>
          <li>{exchangeWords.removed(old)}</li>
          <li>{exchangeWords.takesPlace}</li>
          <li>{exchangeWords.proposed}</li>
        </ul>
        {ends === undefined ? (
          standing.fetchStatus === 'paused' || standing.isError ? (
            <p className="text-[13px] leading-[1.4] text-ink-muted">{exchangeWords.unread}</p>
          ) : null
        ) : (
          <>
            {ends.duties + ends.defects + ends.activities > 0 ? (
              <Group title={exchangeWords.ends(old)}>
                <ul className={pointList}>
                  {ends.duties > 0 ? <li>{exchangeWords.duties(ends.duties)}</li> : null}
                  {ends.defects > 0 ? (
                    <li>
                      {named(
                        exchangeWords.defects(ends.defects),
                        ends.openDefects.map((defect) => defect.description),
                      )}
                    </li>
                  ) : null}
                  {ends.activities > 0 ? (
                    <li>
                      {named(
                        exchangeWords.activities(ends.activities),
                        ends.openActivities.map((activity) => activity.title),
                      )}
                    </li>
                  ) : null}
                </ul>
              </Group>
            ) : null}
            {ends.ownDuties.length > 0 ? (
              <Group title={keepsDuties ? exchangeWords.ownDuties : exchangeWords.ownDutiesEnd}>
                {keepsDuties ? (
                  ends.ownDuties.map((duty) => (
                    <Tick
                      key={duty.id}
                      label={duty.label ?? ''}
                      sub={everyWords(duty)}
                      checked={duties.includes(duty.id)}
                      onChange={(checked) => {
                        setDuties(toggled(duties, duty.id, checked))
                      }}
                    />
                  ))
                ) : (
                  <>
                    <ul className={pointList}>
                      {ends.ownDuties.map((duty) => (
                        <li key={duty.id}>
                          {duty.label}, {everyWords(duty)}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[12px] text-ink-muted">{exchangeWords.needsDutyRight}</p>
                  </>
                )}
              </Group>
            ) : null}
          </>
        )}
        {asset.components.length > 0 ? (
          <Group title={exchangeWords.components}>
            {asset.components.map((component) => (
              <Tick
                key={component.id}
                label={component.name}
                sub={[component.number, kindLabel(catalogue, component.kind)]
                  .filter(Boolean)
                  .join(', ')}
                checked={components.includes(component.id)}
                onChange={(checked) => {
                  setComponents(toggled(components, component.id, checked))
                }}
              />
            ))}
            <p className="text-[12px] text-ink-muted">{exchangeWords.componentsStay(old)}</p>
          </Group>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          {asksAgain ? (
            <Button
              type="button"
              tone="primary"
              icon={ArrowLeftRight}
              disabled={working}
              onClick={() => {
                void exchange(true)
              }}
            >
              {working ? 'Einen Moment' : 'Trotzdem tauschen'}
            </Button>
          ) : (
            <Button type="submit" tone="primary" icon={ArrowLeftRight} disabled={working}>
              {working ? 'Einen Moment' : 'Tauschen'}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** How often a duty of the operator's own falls due, "alle 12 Monate": such a duty always recurs. */
function everyWords(duty: ExchangeStanding['ownDuties'][number]): string {
  const interval = dutyInterval(duty)

  return interval === null ? '' : `alle ${intervalWords(interval)}`
}
