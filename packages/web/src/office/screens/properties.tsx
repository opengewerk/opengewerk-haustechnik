import {
  type Area,
  federalStates,
  propertyProblems,
  type RecordState,
  ruleScopeNames,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Column,
  isNarrow,
  Panel,
  TablePanel,
  useBand,
} from '@opengewerk/platform-web'
import {
  ChangesButton,
  Chip,
  Empty,
  EmptyState,
  FactList,
  ListCard,
  NoteBox,
  PageHead,
  RecordColumns,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  asTextOrNull,
  type EditResult,
  type FormField,
  maybeText,
  RecordForm,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Building2, Pencil, Plus } from 'lucide-react'
import { type ReactNode, useId, useMemo, useState } from 'react'

import { kindsOf } from '../../app/place-records.js'
import { areaName, useAreas, useAreasQuery } from '../../session/areas.js'
import { makeAt } from '../../sync/made-at.js'
import { AreaBadge } from '../area-badge.js'
import { officePlaces, placeForms } from '../place-addresses.js'
import { NotAllowed, RemovePlace } from '../place-forms.js'
import { DocumentsCard } from '../documents.js'
import { PropertyContacts } from '../property-contacts.js'

/**
 * The properties of a tenant in the office (4.1 of the concept): the list
 * with the buildings under each, the page of one, and the form it is made
 * and changed with.
 *
 * A property is kept by the office and with a connection (ADR 0006, point
 * 6); a device holds it to read it. So the list and the page are those of
 * the device and stand without a network, and the form says before anybody
 * fills it in when there is none.
 *
 * The people to talk to at a property stand on its page, in the card of the
 * foundation (`../property-contacts.tsx`). Each of its buildings leads to
 * the page of that building (`buildings.tsx`).
 *
 * What the boards draw beyond this arrives with what it shows: the numbers
 * per property and building and the order by urgency with the register of
 * duties, the import, the photos and the timeline each with their own step.
 */

const list = officePlaces.list
const listPath = list.to
const pageOf = officePlaces.property

function byName(left: RecordState, right: RecordState): number {
  return text(left, 'name').localeCompare(text(right, 'name'), 'de')
}

/** "12 Liegenschaften, 31 Gebäude", "1 Liegenschaft, 1 Gebäude". */
export function counted(properties: number, buildings: number): string {
  return [
    `${properties.toLocaleString('de-DE')} ${properties === 1 ? 'Liegenschaft' : 'Liegenschaften'}`,
    `${buildings.toLocaleString('de-DE')} Gebäude`,
  ].join(', ')
}

/** "Musterweg 1, 00001 Beispielstadt". */
function addressOf(property: RecordState): string {
  return `${text(property, 'street')}, ${placeOf(property)}`
}

/** "00001 Beispielstadt". */
function placeOf(property: RecordState): string {
  return `${text(property, 'postalCode')} ${text(property, 'city')}`
}

/** The buildings by the property they stand on, each list by name. */
function useBuildingsByProperty(): ReadonlyMap<string, readonly RecordState[]> {
  const buildings = useRecords('buildings')

  return useMemo(() => {
    const sorted = new Map<string, RecordState[]>()

    for (const building of [...buildings].sort(byName)) {
      const propertyId = String(building['propertyId'])

      sorted.set(propertyId, [...(sorted.get(propertyId) ?? []), building])
    }

    return sorted
  }, [buildings])
}

/** What is searched in a property: its name, where it is, and its buildings. */
function searchedIn(property: RecordState, buildings: readonly RecordState[]): string {
  return [
    text(property, 'name'),
    text(property, 'street'),
    text(property, 'postalCode'),
    text(property, 'city'),
    ...buildings.map((building) => text(building, 'name')),
  ]
    .join(' ')
    .toLocaleLowerCase('de')
}

/**
 * The list, `liegenschaften()` of the boards: every property with its
 * buildings under it, in the order of their names, narrowed to an area where
 * the person sees more than one. Below 1024 pixels there is a search of its
 * own, because the header has none there, and on a phone a card per property.
 */
export function PropertyListScreen() {
  const properties = useRecords('properties')
  const buildings = useBuildingsByProperty()
  const areas = useAreasQuery()
  const creates = useRight('location.write')
  const band = useBand()
  const narrow = isNarrow(band)
  const phone = band === 'S'
  const navigate = useNavigate()
  const searchId = useId()
  const countId = useId()
  const [pressed, setPressed] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  const known = areas.data ?? []
  // An area that is gone, or one the person no longer holds in, narrows nothing.
  const areaId = known.some((area) => area.id === pressed) ? pressed : null
  // Somebody who sees one area is told nothing by its name.
  const showsAreas = known.length > 1
  // The field stands below 1024 pixels only, and a search nobody sees narrows nothing.
  const search = narrow ? typed.trim().toLocaleLowerCase('de') : ''

  const buildingsOf = (property: RecordState) => buildings.get(String(property['id'])) ?? []
  const shown = [...properties]
    .filter((property) => areaId === null || property['areaId'] === areaId)
    .filter(
      (property) => search === '' || searchedIn(property, buildingsOf(property)).includes(search),
    )
    .sort(byName)
  const shownBuildings = shown.reduce((sum, property) => sum + buildingsOf(property).length, 0)
  const allBuildings = properties.reduce((sum, property) => sum + buildingsOf(property).length, 0)

  const create = creates ? (
    <Button
      tone="primary"
      icon={Plus}
      onClick={() => {
        void navigate({ to: `${listPath}/neu` })
      }}
    >
      Neue Liegenschaft
    </Button>
  ) : null

  if (properties.length === 0) {
    return (
      <Screen className="grow">
        <PageHead title="Liegenschaften" count={counted(0, 0)} actions={create} />
        <NoProperty seesNoArea={areas.isSuccess && known.length === 0} action={create} />
      </Screen>
    )
  }

  const filters =
    narrow || showsAreas ? (
      <div className={narrow ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'}>
        {narrow ? (
          <>
            <label htmlFor={searchId} className="sr-only">
              Liegenschaften durchsuchen
            </label>
            <input
              id={searchId}
              type="search"
              value={typed}
              placeholder="Name, Ort, Straße …"
              aria-describedby={countId}
              onChange={(event) => {
                setTyped(event.target.value)
              }}
              className="h-12 w-full min-w-0 rounded-[5px] border border-line-strong bg-input px-3 text-[16px] text-ink"
            />
          </>
        ) : null}
        {showsAreas ? (
          <div className="flex flex-wrap gap-1.5 lg:gap-2" role="group" aria-label="Bereich">
            <Chip
              pressed={areaId === null}
              onPress={() => {
                setPressed(null)
              }}
            >
              Alle Bereiche
            </Chip>
            {known.map((area) => (
              <Chip
                key={area.id}
                pressed={areaId === area.id}
                onPress={() => {
                  setPressed(area.id)
                }}
              >
                {area.name}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
    ) : null

  const nothingFound =
    shown.length === 0 ? (
      <p className="rounded-[5px] border border-line bg-surface px-3.5 py-6 text-[14px] text-ink-muted">
        {search === ''
          ? 'In diesem Bereich steht keine Liegenschaft.'
          : `Für „${typed.trim()}“ gibt es keinen Treffer.`}
      </p>
    ) : null

  return (
    <Screen>
      <PageHead
        title="Liegenschaften"
        count={counted(properties.length, allBuildings)}
        actions={create}
      />
      {filters}
      {/* What the search or the area left, said to whoever does not see the list change. */}
      <p id={countId} role="status" className="sr-only">
        {shown.length === properties.length
          ? counted(shown.length, shownBuildings)
          : `${counted(shown.length, shownBuildings)} von ${properties.length.toLocaleString('de-DE')}`}
      </p>
      {nothingFound ??
        (phone ? (
          <ul className="flex flex-col gap-2">
            {shown.map((property) => (
              <li key={String(property['id'])}>
                <ListCard
                  to={pageOf(String(property['id']))}
                  title={text(property, 'name')}
                  sub={[
                    text(property, 'city'),
                    showsAreas ? areaWords(known, property) : null,
                    `${buildingsOf(property).length.toLocaleString('de-DE')} Gebäude`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </li>
            ))}
          </ul>
        ) : (
          <TablePanel
            caption="Liegenschaften mit ihren Gebäuden"
            footer={<span className="numeric">{counted(shown.length, shownBuildings)}</span>}
          >
            <thead>
              <tr>
                <Column className="min-w-[240px]">Liegenschaft und Gebäude</Column>
                {showsAreas ? <Column className="w-[140px] min-w-[80px]">Bereich</Column> : null}
              </tr>
            </thead>
            <tbody>
              {shown.flatMap((property) => [
                <tr key={String(property['id'])}>
                  <Cell>
                    <div className="leading-[1.3]">
                      <div className="font-medium">
                        <Link to={pageOf(String(property['id']))}>{text(property, 'name')}</Link>
                      </div>
                      <div className="text-[12px] text-ink-faint">{addressOf(property)}</div>
                    </div>
                  </Cell>
                  {showsAreas ? <Cell>{areaName(known, property['areaId']) ?? ''}</Cell> : null}
                </tr>,
                ...buildingsOf(property).map((building) => (
                  <tr key={String(building['id'])}>
                    <Cell>
                      <div className="flex items-center gap-1.5 pl-[18px] text-ink-muted">
                        <Building2
                          size={13}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="shrink-0"
                        />
                        {/* The indent says it to the eye; a reader of the table hears it. */}
                        <span>
                          <span className="sr-only">Gebäude: </span>
                          <Link to={officePlaces.building(String(building['id']))}>
                            {text(building, 'name')}
                          </Link>
                        </span>
                      </div>
                    </Cell>
                    {showsAreas ? <Cell>{null}</Cell> : null}
                  </tr>
                )),
              ])}
            </tbody>
          </TablePanel>
        ))}
    </Screen>
  )
}

/** "Bereich Nord" on a card, or nothing while the areas are not known. */
function areaWords(areas: readonly Area[], property: RecordState): string | null {
  const name = areaName(areas, property['areaId'])

  return name === null ? null : `Bereich ${name}`
}

/**
 * The list before its first property, as every empty list of the office is
 * drawn. Somebody who holds in no area sees nothing with a place (2.8), and
 * is told that instead of being told that there is nothing.
 */
function NoProperty({
  seesNoArea,
  action,
}: {
  readonly seesNoArea: boolean
  readonly action: ReactNode
}) {
  return seesNoArea ? (
    <EmptyState icon={Building2} title="Kein Bereich für diesen Zugang">
      Dieser Zugang ist für keinen Bereich eingetragen und sieht deshalb keine Liegenschaft. Welche
      Bereiche ein Zugang sieht, legt die Leitung fest.
    </EmptyState>
  ) : (
    <EmptyState icon={Building2} title="Noch keine Liegenschaft angelegt" action={action}>
      Eine Liegenschaft ist ein Standort mit Anschrift und Bundesland: ein Schulzentrum, ein
      Werkhof, eine Wohnanlage. Unter ihr stehen ihre Gebäude, Geschosse und Räume.
    </EmptyState>
  )
}

const notFound =
  'Diese Liegenschaft gibt es nicht mehr, sie liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt sie noch nicht.'

function NotFound() {
  return (
    <Screen>
      <PageHead title="Nicht gefunden" crumbs={[list]} />
      <Empty>{notFound}</Empty>
    </Screen>
  )
}

/**
 * One property, `liegenschaft()` of the boards: where it is and who to talk
 * to there at the left, its buildings beside that. The area stands beside the
 * name for whoever sees more than one.
 */
export function PropertyScreen() {
  const { propertyId } = useParams({ strict: false }) as { propertyId?: string }
  const property = useRecord('properties', propertyId)
  const buildings = useRelated('buildings', 'propertyId', propertyId)
  const areas = useAreas()
  const writes = useRight('location.write')
  const navigate = useNavigate()

  if (!property || !propertyId) {
    return <NotFound />
  }

  const area = areas.length > 1 ? areaName(areas, property['areaId']) : null
  const edit = () => {
    void navigate({ to: `${pageOf(propertyId)}/bearbeiten` })
  }

  return (
    <Screen>
      <PageHead
        title={text(property, 'name')}
        crumbs={[list]}
        phoneBack={list}
        badges={area === null ? null : <AreaBadge name={area} />}
        actions={
          <>
            <ChangesButton table="properties" id={propertyId} />
            {writes ? (
              <>
                <Button icon={Pencil} onClick={edit}>
                  Bearbeiten
                </Button>
                <Button
                  tone="primary"
                  icon={Plus}
                  onClick={() => {
                    void navigate({ to: placeForms.newBuilding(propertyId) })
                  }}
                >
                  Neues Gebäude
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <RecordColumns
        sideFirst
        sideWidth={340}
        side={
          <>
            <Panel
              title="Anschrift"
              action={
                // As the board draws it from a tablet on. On a phone the same
                // button stands a thumb above it, at the head of the page.
                writes ? (
                  <span className="max-sm:hidden">
                    <Button size="small" onClick={edit}>
                      Bearbeiten
                    </Button>
                  </span>
                ) : null
              }
            >
              <FactList
                keyWidth={96}
                facts={[
                  { label: 'Straße', value: text(property, 'street') },
                  { label: 'Ort', value: placeOf(property) },
                  { label: 'Bundesland', value: stateName(property['federalState']) },
                  { label: 'Land', value: country.label },
                  ...(maybeText(property, 'note') === null
                    ? []
                    : [
                        {
                          label: 'Notiz',
                          value: (
                            <span className="whitespace-pre-line">{text(property, 'note')}</span>
                          ),
                        },
                      ]),
                ]}
              />
            </Panel>
            <PropertyContacts propertyId={propertyId} />
            <DocumentsCard place={{ propertyId }} at={`Liegenschaft ${text(property, 'name')}`} />
          </>
        }
        main={<Buildings buildings={[...buildings].sort(byName)} />}
      />
    </Screen>
  )
}

/** "Gebäude": what stands on the property, by name, with what it is used as. */
function Buildings({ buildings }: { readonly buildings: readonly RecordState[] }) {
  if (buildings.length === 0) {
    return (
      <Panel title="Gebäude">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          An dieser Liegenschaft steht noch kein Gebäude.
        </p>
      </Panel>
    )
  }

  const year = (building: RecordState) =>
    typeof building['yearBuilt'] === 'number' ? String(building['yearBuilt']) : ''

  return (
    <TablePanel
      title="Gebäude"
      caption="Gebäude der Liegenschaft"
      cards={buildings.map((building) => ({
        key: String(building['id']),
        title: (
          <Link to={officePlaces.building(String(building['id']))} className={cardLink}>
            {text(building, 'name')}
          </Link>
        ),
        sub: kindsOf(building).join(', '),
        right:
          year(building) === '' ? undefined : <span className="numeric">{year(building)}</span>,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[220px]">Gebäude</Column>
          <Column numeric className="w-[64px] min-w-[56px]">
            Baujahr
          </Column>
        </tr>
      </thead>
      <tbody>
        {buildings.map((building) => (
          <tr key={String(building['id'])}>
            <Cell>
              <div className="leading-[1.3]">
                <div className="font-medium">
                  <Link to={officePlaces.building(String(building['id']))}>
                    {text(building, 'name')}
                  </Link>
                </div>
                <div className="text-[12px] text-ink-faint">{kindsOf(building).join(', ')}</div>
              </div>
            </Cell>
            <Cell numeric>{year(building)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The sixteen states by their names, as a form offers them. */
const states = federalStates
  .map((state) => ({ value: state as string, label: ruleScopeNames[state] }))
  .sort((left, right) => left.label.localeCompare(right.label, 'de'))

function stateName(state: unknown): string {
  return states.find((known) => known.value === state)?.label ?? ''
}

/**
 * The catalogue this application proposes duties from is German law, and a
 * property lies in one of the sixteen states. The field stands in the form
 * as the board draws it and is no column: there is one answer.
 */
const country = { value: 'DE', label: 'Deutschland' } as const

const choose = { value: '', label: 'Bitte wählen' } as const

/** The state most of the properties lie in, or none while there is no property. */
function usualState(properties: readonly RecordState[]): string {
  const counts = new Map<string, number>()

  for (const property of properties) {
    const state = text(property, 'federalState')

    counts.set(state, (counts.get(state) ?? 0) + 1)
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ''
}

const noConnection =
  'Eine Liegenschaft wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

const noAreas =
  'Die Bereiche kamen nicht an. Eine Liegenschaft wird mit Verbindung angelegt und geändert.'

export function NewPropertyScreen() {
  const writes = useRight('location.write')

  return writes ? (
    <PropertyFormScreen propertyId={undefined} />
  ) : (
    <NotAllowed>Liegenschaften anlegen darf dieser Zugang nicht.</NotAllowed>
  )
}

export function EditPropertyScreen() {
  const { propertyId } = useParams({ strict: false }) as { propertyId?: string }
  const writes = useRight('location.write')

  return writes ? (
    <PropertyFormScreen propertyId={propertyId} />
  ) : (
    <NotAllowed>Liegenschaften ändern darf dieser Zugang nicht.</NotAllowed>
  )
}

/**
 * A property to make or to change, `neue_liegenschaft()` of the boards: one
 * card with what it is called, where it lies and what there is to know
 * before going there. Every field that has to be filled in carries a star,
 * the address and the state included: the model asks for all of them, and
 * the state decides which law of a state is proposed.
 *
 * Both need a connection, and the form says so first. The area is asked for
 * only where the tenant has more than one; a small tenant never names one,
 * and the server puts the property into the one there is.
 */
function PropertyFormScreen({ propertyId }: { readonly propertyId: string | undefined }) {
  const client = useSync()
  const status = useSyncStatus()
  const navigate = useNavigate()
  const property = useRecord('properties', propertyId)
  const properties = useRecords('properties')
  const areas = useAreasQuery()
  const editing = propertyId !== undefined
  // Settled when the screen opens and not again. On a new device the first
  // exchange may end after the form stands; a state that turned up then would
  // take "Bitte wählen" out of the list while the form still held it, and the
  // list would show a state nobody chose.
  const [usual] = useState(() => usualState(properties))

  if (editing && !property) {
    return <NotFound />
  }

  const name = text(property, 'name')
  const back = () => {
    void navigate({ to: editing ? pageOf(propertyId) : listPath })
  }

  const head = (
    <PageHead
      title={editing ? `${name} bearbeiten` : 'Neue Liegenschaft'}
      crumbs={editing ? [list, { to: pageOf(propertyId), label: name }] : [list]}
    />
  )

  if (!areas.isSuccess) {
    // Without a network the question is not even asked, and would stay
    // "Wird geladen." for as long as the screen stands.
    const waits = areas.isPending && areas.fetchStatus !== 'paused' && status.online

    return (
      <Screen>
        {head}
        {waits ? (
          <p className="text-[13px] text-ink-muted">Wird geladen.</p>
        ) : (
          <NoteBox tone="waiting">
            {areas.isError && status.online ? noAreas : noConnection}
          </NoteBox>
        )}
      </Screen>
    )
  }

  const asksArea = areas.data.length > 1

  const fields: readonly FormField[] = [
    { name: 'name', label: 'Name', required: true, place: 'lg:col-span-3' },
    ...(asksArea
      ? [
          {
            name: 'areaId',
            label: 'Bereich',
            required: true,
            options: [
              ...(editing ? [] : [choose]),
              ...areas.data.map((area) => ({ value: area.id as string, label: area.name })),
            ],
            hint: 'Wer den Bereich nicht hat, sieht die Liegenschaft nicht.',
            place: 'lg:col-span-3',
          },
        ]
      : []),
    {
      name: 'street',
      label: 'Straße und Hausnummer',
      required: true,
      place: asksArea ? 'sm:col-span-2 lg:col-span-3' : 'lg:col-span-3',
    },
    {
      name: 'postalCode',
      label: 'Postleitzahl',
      required: true,
      numeric: true,
      place: 'lg:col-span-1',
    },
    { name: 'city', label: 'Ort', required: true, place: 'lg:col-span-2' },
    {
      name: 'federalState',
      label: 'Bundesland',
      required: true,
      options: editing || usual !== '' ? states : [choose, ...states],
      hint: 'Das Bundesland entscheidet, welches Landesrecht vorgeschlagen wird.',
      place: 'lg:col-span-3',
    },
    { name: 'country', label: 'Land', options: [country], place: 'lg:col-span-3' },
    {
      name: 'note',
      label: 'Notiz',
      kind: 'textarea',
      placeholder: 'Zufahrt, Schlüssel beim Hausmeister, Besonderheiten',
      // The sealed place for a code arrives with the accesses (4.13 of the
      // concept); a note is read on every device that holds the property,
      // and every change of it stands in the log.
      hint: 'Keine Codes oder Zugangsdaten: die Notiz liest jeder, der die Liegenschaft sieht.',
    },
  ]

  /** What the form collected, as the route and the model take it. */
  const wanted = (values: Readonly<Record<string, string>>) => ({
    name: (values['name'] ?? '').trim(),
    ...(asksArea ? { areaId: values['areaId'] ?? '' } : {}),
    street: (values['street'] ?? '').trim(),
    postalCode: (values['postalCode'] ?? '').trim(),
    city: (values['city'] ?? '').trim(),
    federalState: values['federalState'] ?? '',
    note: asTextOrNull(values['note']),
  })

  async function save(values: Record<string, string>): Promise<EditResult> {
    const result = editing
      ? await client.update('properties', propertyId, wanted(values))
      : await makeAt(client, '/properties', wanted(values))

    if (result.outcome === 'queued') {
      await navigate({ to: pageOf(result.id) })
    }

    return result
  }

  return (
    <Screen>
      {head}
      <Panel className="max-w-[860px] px-5! py-[18px]!">
        <RecordForm
          // Made anew for another property: a form reads what it starts with
          // once, and the browser's way back may lead from one to another.
          key={propertyId ?? 'new'}
          fields={fields}
          // A new property starts in the state most of the others lie in.
          record={editing ? property : { federalState: usual }}
          columns="lg:grid-cols-6"
          starred
          divided={false}
          submitLabel={editing ? 'Speichern' : 'Liegenschaft anlegen'}
          onSubmit={save}
          onCancel={back}
          disabled={!status.online}
          disabledReason={noConnection}
          check={(values) => {
            const asked = wanted(values)
            const [problem] = Object.values(propertyProblems(asked))

            return problem ?? (asksArea && asked.areaId === '' ? 'Der Bereich fehlt.' : null)
          }}
          after={
            editing ? null : (
              <NoteBox>
                Gebäude, Geschosse und Räume legen Sie danach in der Liegenschaft an.
              </NoteBox>
            )
          }
          extraAction={
            editing ? (
              <RemoveProperty propertyId={propertyId} name={name} disabled={!status.online} />
            ) : undefined
          }
        />
      </Panel>
    </Screen>
  )
}

/**
 * Removing a property, with a question first. Everything on it goes with it,
 * and the question says so; what holds evidence stays, and the server says
 * that when it refuses.
 */
function RemoveProperty({
  propertyId,
  name,
  disabled,
}: {
  readonly propertyId: string
  readonly name: string
  readonly disabled: boolean
}) {
  const client = useSync()
  const navigate = useNavigate()

  return (
    <RemovePlace
      label="Liegenschaft entfernen"
      question={`„${name}“ entfernen?`}
      disabled={disabled}
      remove={() => client.remove('properties', propertyId)}
      onRemoved={() => navigate({ to: listPath })}
    >
      Mit der Liegenschaft gehen ihre Ansprechpartner, ihre Gebäude, Geschosse und Räume, die
      Anlagen darin und alle Pflichten, Vorgänge und Mängel dort. Eine Anlage mit Nachweis wird
      nicht entfernt, und dann bleibt auch die Liegenschaft.
    </RemovePlace>
  )
}
