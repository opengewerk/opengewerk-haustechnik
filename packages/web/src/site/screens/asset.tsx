import {
  activityKindLabel,
  type ActivityKind,
  type Catalogue,
  type DutyReading,
  evidenceResultLabel,
  evidenceStandingLabel,
  isGeneralKind,
  printedLabelCode,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Panel, Status } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteCrumbs,
  type SiteFact,
  SiteFacts,
  SiteHeader,
  SiteLink,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  request,
  text,
  useRecord,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { QrCode, TriangleAlert } from 'lucide-react'

import { DutyStateMark } from '../../app/asset-marks.js'
import { generalKindNote, kindFields, typedValues, unitOf } from '../../app/asset-values.js'
import { assetEvidenceQuery } from '../../app/evidence.js'
import { useLabelsOf } from '../../app/labels.js'
import { placePath } from '../../app/place-path.js'
import { placeAbove } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { SiteDocuments } from '../documents.js'
import { GoButton, isOpenDefect, kindWords, NotOnDevice, OpenDefects, PlainRow } from '../kit.js'
import { siteDefects, siteForms, sitePlaces, stockTaking } from '../places.js'

export const siteAssetWords = {
  noNumber: 'Nummer folgt nach dem Abgleich',
  noDuties: 'Für diese Anlage ist keine Pflicht bestätigt.',
  dutiesFromServer:
    'Wie eine Pflicht steht, sagt der Server. Ohne Verbindung stehen hier die Pflichten, die das Gerät hält, ohne ihren Stand.',
  noEvidence: 'Für diese Anlage ist noch kein Nachweis festgehalten.',
  evidenceFromServer:
    'Die Nachweise einer Anlage liegen auf dem Server. Mit Verbindung stehen hier die letzten.',
  noLabel: 'Diese Anlage hat noch kein Etikett.',
  valid: 'gültig',
  noDefect: 'Kein offener Mangel an dieser Anlage.',
  noDocument: 'Noch kein Dokument an dieser Anlage.',
  waitsForDecision:
    'Diese Anlage ist noch nicht angelegt: der Server kennt eine mögliche Dublette. Unter Konflikte entscheiden Sie, ob es dieselbe ist oder ob sie trotzdem angelegt wird.',
  work: 'Zu erledigen',
  due: (kind: string, on: string) => `${kind}, fällig am ${date(on)}`,
  begun: (kind: string, on: string) => `${kind}, begonnen am ${date(on)}`,
  open: 'offen',
  started: 'begonnen',
} as const

/**
 * The inspections and maintenance of an asset this device holds that are
 * still to be done or under way, and that the own people perform (#108): what
 * leads from the asset to its protocol. A contractor's comes into the office
 * as a report (#110), a round and a work order have pages of their own.
 */
function workAt(activities: readonly RecordState[], assetId: string): readonly RecordState[] {
  return activities.filter(
    (activity) =>
      activity['assetId'] === assetId &&
      (activity['status'] === 'open' || activity['status'] === 'started') &&
      (activity['kind'] === 'inspection' || activity['kind'] === 'maintenance') &&
      activity['performer'] !== 'contractor',
  )
}

/** How many of the evidence of an asset its page on site names, the newest first. */
const lastEvidence = 3

/** The values of an asset as a device holds them: the text of an object. */
function valuesOf(asset: RecordState): Readonly<Record<string, never>> {
  const held: unknown = asset['values']

  if (typeof held !== 'string') {
    return (held ?? {}) as Readonly<Record<string, never>>
  }

  try {
    return JSON.parse(held) as Readonly<Record<string, never>>
  } catch {
    return {}
  }
}

/** What is known about an asset, as the card "Angaben" lists it: only what somebody entered. */
function factsOf(asset: RecordState, catalogue: Catalogue | null): readonly SiteFact[] {
  const key = maybeText(asset, 'kind')
  const kind = key === null ? null : (catalogue?.assetKind(key, today())?.definition ?? null)
  const year = asset['yearBuilt']
  const typed = kind ? typedValues(kind, valuesOf(asset)) : {}
  const makerAndModel = [maybeText(asset, 'manufacturer'), maybeText(asset, 'model')]
    .filter(Boolean)
    .join(' ')

  return [
    { label: 'Anlagenart', value: kindWords(catalogue, key) },
    { label: 'Hersteller und Typ', value: makerAndModel },
    { label: 'Seriennummer', value: maybeText(asset, 'serialNumber') ?? '' },
    { label: 'Baujahr', value: typeof year === 'number' ? String(year) : '' },
    ...(kind
      ? kindFields(kind).map((entry) => {
          const said = typed[entry.field.key] ?? ''
          const { field } = entry
          const unit = unitOf(entry)
          const value =
            said === ''
              ? ''
              : field.kind === 'flag'
                ? said === 'true'
                  ? 'Ja'
                  : 'Nein'
                : field.kind === 'choice'
                  ? (field.options.find((option) => option.value === said)?.label ?? said)
                  : field.kind === 'date'
                    ? date(said)
                    : unit === undefined
                      ? said
                      : `${said} ${unit}`

          return { label: field.label, value }
        })
      : []),
  ].filter((fact) => fact.value !== '')
}

/**
 * An asset on site (#99, board "Anlage mit dem Pfad darüber"): what is known
 * about it, its duties, its open defects, its label and its documents, under
 * the path that leads up to its property.
 *
 * What the device holds stands without a network: the facts, the defects,
 * the label and the documents. How a duty stands follows from the evidence,
 * which never travels to a device, so the server says it, with a connection;
 * without one the duties stand here by their names. The last evidence is the
 * server's as well, and stands here only with a connection. "Mangel melden"
 * reports a defect at it, also without a network (#116).
 */
export function SiteAssetScreen() {
  const { assetId } = useParams({ strict: false }) as { assetId?: string }
  const client = useSync()
  const { online, conflicts } = useSyncStatus()
  const asset = useRecord('assets', assetId)
  const parent = useRecord('assets', maybeText(asset, 'parentAssetId') ?? undefined)
  const room = useRecord('rooms', maybeText(asset, 'roomId') ?? undefined)
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)
  const building = useRecord('buildings', maybeText(asset, 'buildingId') ?? undefined)
  // An asset made on this device a moment ago has no property yet: the
  // server derives it. The building it stands in names the same one.
  const propertyId = maybeText(asset, 'propertyId') ?? maybeText(building, 'propertyId')
  const property = useRecord('properties', propertyId ?? undefined)
  const catalogue = useCatalogue()
  const seesDuties = useRight('duty.read')
  const seesEvidence = useRight('evidence.read')
  const records = useRight('asset.record')
  const reports = useRight('defect.report')
  const performs = useRight('activity.perform')
  const work = workAt(useRecords('activities'), assetId ?? '')
  const heldDuties = useRecords('duties').filter((duty) => duty['assetId'] === assetId)
  const defects = useRecords('defects').filter(
    (defect) => defect['assetId'] === assetId && isOpenDefect(defect),
  )
  const { valid: label } = useLabelsOf('assets', assetId ?? '')
  const waiting = assetId !== undefined && client.isPending('assets', assetId)
  const asked = useQuery({
    queryKey: ['assets', 'duties', assetId],
    queryFn: () => request<DutyReading[]>(`/assets/${assetId ?? ''}/duties`),
    enabled: assetId !== undefined && asset !== null && seesDuties && online && !waiting,
  })
  const evidence = useQuery({
    ...assetEvidenceQuery(assetId ?? ''),
    enabled: assetId !== undefined && asset !== null && seesEvidence && online && !waiting,
  })

  if (!asset || assetId === undefined) {
    const toStart = { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }

    // Taken in a moment ago and not made: the server found a possible
    // duplicate, and the asset waits among the conflicts for a decision.
    return conflicts.some((conflict) => conflict.recordId === assetId) ? (
      <>
        <SiteHeader title="Wartet auf eine Entscheidung" back={toStart} />
        <SiteScreen>
          <SiteText>{siteAssetWords.waitsForDecision}</SiteText>
          <SiteText>
            <SiteLink to="/konflikte">Zu den Konflikten</SiteLink>
          </SiteText>
        </SiteScreen>
      </>
    ) : (
      <NotOnDevice what="Diese Anlage" back={toStart} />
    )
  }

  const number = maybeText(asset, 'number')
  const key = maybeText(asset, 'kind')
  const back = room
    ? { to: sitePlaces.room(String(room['id'])), label: 'Zurück zum Raum' }
    : building
      ? { to: sitePlaces.building(String(building['id'])), label: 'Zurück zum Gebäude' }
      : { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }

  return (
    <>
      <SiteHeader title={text(asset, 'name')} sub={number ?? siteAssetWords.noNumber} back={back} />
      <SiteScreen>
        {property ? (
          <SiteCrumbs
            items={placePath(
              placeAbove({ property, building, floor, room, asset: parent }),
              sitePlaces,
            )}
          />
        ) : null}
        {performs && work.length > 0 ? (
          <Panel title={siteAssetWords.work}>
            <SiteRows label={siteAssetWords.work}>
              {work.map((activity) => {
                const kind = activityKindLabel[activity['kind'] as ActivityKind]
                const begun = activity['status'] === 'started'
                const performedOn = maybeText(activity, 'performedOn')
                const dueOn = maybeText(activity, 'dueOn')

                return (
                  <SiteRow
                    key={String(activity['id'])}
                    to={siteForms.form(String(activity['id']))}
                    title={text(activity, 'title')}
                    meta={
                      begun && performedOn !== null
                        ? siteAssetWords.begun(kind, performedOn)
                        : dueOn !== null
                          ? siteAssetWords.due(kind, dueOn)
                          : kind
                    }
                    right={
                      <Status tone={begun ? 'neutral' : 'waiting'}>
                        {begun ? siteAssetWords.started : siteAssetWords.open}
                      </Status>
                    }
                  />
                )
              })}
            </SiteRows>
          </Panel>
        ) : null}
        <Panel title="Angaben">
          <div className="flex flex-col gap-2.5">
            <SiteFacts facts={factsOf(asset, catalogue)} />
            {key !== null && isGeneralKind(key) ? (
              <SiteText muted size={15}>
                {generalKindNote}
              </SiteText>
            ) : null}
          </div>
        </Panel>
        {seesDuties ? (
          <Panel title="Pflichten">
            {asked.data ? (
              asked.data.length === 0 ? (
                <SiteText muted>{siteAssetWords.noDuties}</SiteText>
              ) : (
                <ul aria-label="Pflichten" className="flex flex-col">
                  {asked.data.map((duty) => (
                    <li key={duty.id} className="flex items-center gap-2 border-b border-row py-2">
                      <span className="min-w-0 grow">
                        <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                          {duty.title}
                        </span>
                        {duty.appointment ? (
                          <span className="block text-[14px] text-ink-muted">
                            {`Termin ${date(duty.appointment.dueOn)}`}
                          </span>
                        ) : null}
                      </span>
                      <DutyStateMark state={duty.state} until={duty.appointment?.dueOn ?? null} />
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div className="flex flex-col gap-2">
                {heldDuties.length === 0 ? (
                  <SiteText muted>{siteAssetWords.noDuties}</SiteText>
                ) : (
                  <ul aria-label="Pflichten" className="flex flex-col">
                    {heldDuties.map((duty) => {
                      const kind = maybeText(duty, 'kind')
                      const version = duty['kindVersion']

                      return (
                        <PlainRow
                          key={String(duty['id'])}
                          title={
                            maybeText(duty, 'label') ??
                            (kind !== null && typeof version === 'number'
                              ? catalogue?.dutyKindVersion(kind, version)?.definition.label
                              : null) ??
                            kind ??
                            'Pflicht'
                          }
                        />
                      )
                    })}
                  </ul>
                )}
                {heldDuties.length === 0 ? null : (
                  <SiteText muted size={15}>
                    {siteAssetWords.dutiesFromServer}
                  </SiteText>
                )}
              </div>
            )}
          </Panel>
        ) : null}
        {seesEvidence ? (
          <Panel title="Letzte Nachweise">
            {evidence.data ? (
              evidence.data.length === 0 ? (
                <SiteText muted>{siteAssetWords.noEvidence}</SiteText>
              ) : (
                <ul aria-label="Letzte Nachweise" className="flex flex-col">
                  {evidence.data.slice(0, lastEvidence).map((entry) => (
                    <PlainRow
                      key={entry.id}
                      title={`${entry.number}, ${date(entry.performedOn)}`}
                      meta={[
                        entry.dutyTitle,
                        evidenceResultLabel[entry.result],
                        entry.standing === 'replaced' || entry.standing === 'voided'
                          ? evidenceStandingLabel[entry.standing].toLowerCase()
                          : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    />
                  ))}
                </ul>
              )
            ) : (
              <SiteText muted size={15}>
                {siteAssetWords.evidenceFromServer}
              </SiteText>
            )}
          </Panel>
        ) : null}
        <OpenDefects defects={defects} empty={siteAssetWords.noDefect} />
        <Panel title="Etikett">
          {label ? (
            <div className="flex items-center gap-2.5">
              <QrCode size={22} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              <span className="numeric min-w-0 grow text-[17px] font-semibold [overflow-wrap:anywhere]">
                {printedLabelCode(text(label, 'code'))}
              </span>
              <Status tone="done">{siteAssetWords.valid}</Status>
            </div>
          ) : (
            <SiteText muted>{siteAssetWords.noLabel}</SiteText>
          )}
        </Panel>
        {propertyId === null ? null : (
          <SiteDocuments place={{ propertyId, assetId }} empty={siteAssetWords.noDocument} />
        )}
      </SiteScreen>
      {(records && !label) || reports ? (
        <SiteActionBar>
          {records && !label ? (
            <GoButton to={stockTaking.label(assetId)} icon={QrCode}>
              Etikett zuordnen
            </GoButton>
          ) : null}
          {reports ? (
            <GoButton to={siteDefects.atAsset(assetId)} icon={TriangleAlert} tone="primary">
              Mangel melden
            </GoButton>
          ) : null}
        </SiteActionBar>
      ) : null}
    </>
  )
}
