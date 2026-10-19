import { type RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Field, IconButton, Panel, SelectField } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import {
  NotSent,
  SiteActionBar,
  SiteCrumbs,
  SiteFacts,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import {
  type Draft,
  type EditResult,
  type FormField,
  maybeText,
  refusalFor,
  text,
  useRecord,
  useSync,
} from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, ChevronRight, Pencil, Plus } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'

import {
  asBoard,
  asEquipment,
  asSection,
  boardFields,
  circuitFacts,
  CircuitForm,
  circuitGroups,
  circuitsInWords,
  circuitSummary,
  equipmentFields,
  equipmentLine,
  newBoard,
  nextPosition,
  ordered,
  sectionFields,
  structurePlaces,
  structureWords,
  useBoards,
  useCircuits,
  useEquipment,
  useSections,
} from '../../app/electrical.js'
import { CircuitSummary } from '../../app/circuit-summary.js'
import { placePath } from '../../app/place-path.js'
import { placeAbove } from '../../app/place-records.js'
import { NotOffered, NotOnDevice } from '../kit.js'
import { sitePlaces, siteStructure, stockTaking } from '../places.js'
import { boardWhere, Count, FormButton, siteStructureWords } from './boards-block.js'

/**
 * The electrical structure of a low-voltage installation on site (#349, the
 * boards "Anlage mit Verteilern", "Verteiler", "Stromkreis" and "Stromkreis
 * hinzufügen"): a board with its circuits section by section, a circuit with
 * what is known about it and its equipment, and the forms that add and change
 * each of them. The boards on the page of the asset are `boards-block.tsx`;
 * these pages are fetched when their address is opened (`router.tsx`).
 *
 * A technician stands in front of a board and takes it down, without a
 * network like everything here: whoever takes stock of assets adds and
 * changes boards, sections, circuits and equipment, and the outbox carries
 * them to the server with the next exchange. Nothing is removed on site; that
 * is the office's, for whoever keeps the assets, where the whole board is on
 * one screen. The circuit chart is printed in the office as well.
 */

/**
 * The places above an asset the device holds, for the path over a page below
 * it; the pages of the PV structure ask it as well (#461).
 */
export function useAssetAbove(assetId: string | undefined) {
  const asset = useRecord('assets', assetId)
  const room = useRecord('rooms', maybeText(asset, 'roomId') ?? undefined)
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)
  const building = useRecord('buildings', maybeText(asset, 'buildingId') ?? undefined)
  // A board taken down on an asset made on this device a moment ago: the
  // server derives its property, and its building names the same one.
  const property = useRecord(
    'properties',
    maybeText(asset, 'propertyId') ?? maybeText(building, 'propertyId') ?? undefined,
  )

  return {
    asset,
    path: property
      ? placePath(placeAbove({ property, building, floor, room, asset }), sitePlaces)
      : [],
  }
}

/**
 * A circuit of a board, `circuit_card()` of the board "Verteiler": its
 * designation on slate as it is printed in the cabinet, what it feeds, how it
 * is protected and wired, and the chevron that opens it.
 */
function CircuitCard({ to, circuit }: { readonly to: string; readonly circuit: RecordState }) {
  const client = useSync()
  const id = String(circuit['id'])
  const summary = circuitSummary(circuit)

  return (
    <li>
      <Link
        to={to}
        className="flex min-h-16 items-center gap-2.5 rounded-[6px] border border-line bg-surface px-3 py-2.5 text-ink no-underline"
      >
        <span className="shrink-0 rounded-[4px] bg-top px-2 py-[3px] font-condensed text-[17px] font-semibold text-top-ink">
          {text(circuit, 'designation')}
        </span>
        {/* Heard as "F2 Steckdosen Küche" and not as one word. */}{' '}
        <span className="min-w-0 grow">
          <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
            {maybeText(circuit, 'consumer') ?? text(circuit, 'designation')}
          </span>
          <span
            className={`mt-0.5 block text-[15px] leading-[1.35] ${summary === null ? 'text-waiting' : 'text-ink-muted'}`}
          >
            {summary === null ? structureWords.nothingKnown : <CircuitSummary summary={summary} />}
            {client.isPending('circuits', id) ? (
              <>
                {', '}
                <NotSent />
              </>
            ) : null}
          </span>
        </span>
        <ChevronRight
          size={20}
          strokeWidth={2.2}
          aria-hidden="true"
          className="shrink-0 text-ink-faint"
        />
      </Link>
    </li>
  )
}

/** The board of the address, if it hangs on the asset of the address. */
function useBoardOf(assetId: string | undefined, boardId: string | undefined) {
  const board = useRecord('distribution_boards', boardId)

  return board !== null && maybeText(board, 'assetId') === assetId ? board : null
}

/**
 * One board on site, the board "Verteiler": its circuits section by section,
 * those on the board directly first under "Ohne Feld", in the order of the
 * chart, each opening its page. Under them the ways to a new section and to
 * the board itself, and at the foot the way to a new circuit.
 */
export function SiteBoardScreen() {
  const { assetId, boardId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
  }
  const navigate = useNavigate()
  const records = useRight('asset.record')
  const { asset, path } = useAssetAbove(assetId)
  const board = useBoardOf(assetId, boardId)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)

  if (!board || !asset || assetId === undefined || boardId === undefined) {
    return (
      <NotOnDevice
        what="Diesen Verteiler"
        back={
          assetId === undefined
            ? { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }
            : { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
        }
      />
    )
  }

  const groups = circuitGroups(sections, circuits)

  return (
    <>
      <SiteHeader
        title={text(board, 'designation')}
        sub={boardWhere(board)}
        back={{ to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }}
      />
      <SiteScreen gap={10}>
        {path.length > 0 ? <SiteCrumbs items={path} /> : null}
        {circuits.length === 0 && sections.length === 0 ? (
          <SiteText muted>{structureWords.noCircuits}</SiteText>
        ) : (
          groups.map((group) => {
            const name = group.section ? text(group.section, 'designation') : null

            return (
              <section
                key={group.key}
                aria-label={name ?? structureWords.withoutSection}
                className="flex flex-col gap-2.5"
              >
                <div className="mt-1.5 flex items-center gap-2">
                  <h2 className="text-[19px] font-bold">{name ?? structureWords.withoutSection}</h2>
                  <span className="min-w-0 grow text-[15px] text-ink-muted">
                    {group.section
                      ? circuitsInWords(group.circuits.length)
                      : `${circuitsInWords(group.circuits.length)}, ${structureWords.direct}`}
                  </span>
                  {group.section && records ? (
                    <IconButton
                      label={`${String(name)} bearbeiten`}
                      onClick={() => {
                        void navigate({
                          to: siteStructure.editSection(assetId, boardId, group.key),
                        })
                      }}
                    >
                      <Pencil size={20} strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </div>
                {group.circuits.length === 0 ? (
                  <SiteText muted>{structureWords.emptySection}</SiteText>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {group.circuits.map((circuit) => (
                      <CircuitCard
                        key={String(circuit['id'])}
                        to={structurePlaces.circuit(assetId, boardId, String(circuit['id']))}
                        circuit={circuit}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })
        )}
        {records ? (
          <div className="mt-1.5 flex flex-col gap-2.5">
            <FormButton to={siteStructure.newSection(assetId, boardId)} icon={Plus}>
              Feld hinzufügen
            </FormButton>
            <FormButton to={siteStructure.editBoard(assetId, boardId)} icon={Pencil}>
              Verteiler bearbeiten
            </FormButton>
          </div>
        ) : null}
      </SiteScreen>
      {records ? (
        <SiteActionBar>
          <Button
            tone="primary"
            wide
            icon={Plus}
            onClick={() => {
              void navigate({ to: siteStructure.newCircuit(assetId, boardId) })
            }}
          >
            Stromkreis hinzufügen
          </Button>
        </SiteActionBar>
      ) : null}
    </>
  )
}

/** The circuit of the address, if it is one of the board of the address. */
function useCircuitOf(boardId: string | undefined, circuitId: string | undefined) {
  const circuit = useRecord('circuits', circuitId)

  return circuit !== null && maybeText(circuit, 'distributionBoardId') === boardId ? circuit : null
}

/**
 * One circuit on site, the board "Stromkreis": what is known about it with
 * the way to fill in the rest at the foot of that card, and its equipment,
 * each with the way to change it, and the way to one more.
 */
export function SiteCircuitScreen() {
  const { assetId, boardId, circuitId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
    circuitId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset, path } = useAssetAbove(assetId)
  const board = useBoardOf(assetId, boardId)
  const circuit = useCircuitOf(boardId, circuitId)
  const section = useRecord('board_sections', maybeText(circuit, 'boardSectionId') ?? undefined)
  const equipment = useEquipment(circuit ? circuitId : undefined)

  if (
    !circuit ||
    !board ||
    !asset ||
    assetId === undefined ||
    boardId === undefined ||
    circuitId === undefined
  ) {
    return (
      <NotOnDevice
        what="Diesen Stromkreis"
        back={
          assetId !== undefined && boardId !== undefined
            ? { to: structurePlaces.board(assetId, boardId), label: 'Zurück zum Verteiler' }
            : { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }
        }
      />
    )
  }

  const facts = circuitFacts(circuit)

  return (
    <>
      <SiteHeader
        title={text(circuit, 'designation')}
        sub={[
          'Stromkreis',
          section ? text(section, 'designation') : null,
          text(board, 'designation'),
        ]
          .filter(Boolean)
          .join(', ')}
        back={{ to: structurePlaces.board(assetId, boardId), label: 'Zurück zum Verteiler' }}
      />
      <SiteScreen>
        {path.length > 0 ? (
          <SiteCrumbs
            items={[
              ...path,
              { to: structurePlaces.board(assetId, boardId), label: text(board, 'designation') },
            ]}
          />
        ) : null}
        <Panel title="Angaben">
          <div className="flex flex-col gap-3">
            {facts.length === 0 ? (
              <SiteText muted>{structureWords.noFacts}</SiteText>
            ) : (
              <SiteFacts facts={facts} />
            )}
            {records ? (
              <FormButton to={siteStructure.editCircuit(assetId, boardId, circuitId)} icon={Pencil}>
                Bearbeiten
              </FormButton>
            ) : null}
          </div>
        </Panel>
        <Panel
          title="Betriebsmittel"
          action={equipment.length === 0 ? null : <Count total={equipment.length} />}
        >
          <div className="flex flex-col gap-2.5">
            {equipment.length === 0 ? (
              <SiteText muted>{structureWords.noEquipment}</SiteText>
            ) : (
              <ul aria-label="Betriebsmittel" className="flex flex-col">
                {equipment.map((item) => {
                  const id = String(item['id'])
                  const name = text(item, 'designation')

                  return (
                    <li
                      key={id}
                      className="flex min-h-14 items-center gap-2 border-b border-row py-2"
                    >
                      <span className="min-w-0 grow">
                        <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                          {name}
                        </span>
                        <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">
                          {equipmentLine(item, ', ')}
                          {client.isPending('equipment', id) ? (
                            <>
                              {equipmentLine(item, ', ') === '' ? null : ', '}
                              <NotSent />
                            </>
                          ) : null}
                        </span>
                      </span>
                      {records ? (
                        <IconButton
                          label={`${name} bearbeiten`}
                          onClick={() => {
                            void navigate({
                              to: siteStructure.editEquipment(assetId, boardId, circuitId, id),
                            })
                          }}
                        >
                          <Pencil size={20} strokeWidth={2} aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {records ? (
              <FormButton to={siteStructure.newEquipment(assetId, boardId, circuitId)} icon={Plus}>
                Betriebsmittel hinzufügen
              </FormButton>
            ) : null}
          </div>
        </Panel>
      </SiteScreen>
    </>
  )
}

/** What a field of a form starts with: what the record holds, as text, or its first choice. */
function heldIn(record: RecordState | null | undefined, field: FormField): string {
  const value = record?.[field.name]

  return value === null || value === undefined ? (field.options?.[0]?.value ?? '') : String(value)
}

/**
 * The form of a board, a section or a piece of equipment on site, with the
 * fields the foundation names for them, in the frame of the form of a
 * circuit: one field under the other, and at the foot the way out beside the
 * button that saves, over the sentence that says where it goes. The
 * designation is asked for before anything is queued.
 */
function SitePartForm({
  fields,
  record,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly fields: readonly FormField[]
  readonly record?: RecordState | null
  readonly submitLabel: string
  readonly onSubmit: (values: Record<string, string>) => Promise<EditResult>
  readonly onCancel: () => void
}) {
  const formId = useId()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, heldIn(record, field)])),
  )
  const [missing, setMissing] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const empty = (values['designation'] ?? '').trim() === ''

    setMissing(empty)

    if (empty) {
      return
    }

    setWorking(true)

    try {
      const result = await onSubmit(values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      }
    } catch {
      setTrouble(siteStructureWords.notKept)
    } finally {
      setWorking(false)
    }
  }

  const set = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }))
  }

  return (
    <form
      id={formId}
      noValidate
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      {fields.map((field) =>
        field.options ? (
          <SelectField
            key={field.name}
            label={field.label}
            options={field.options}
            required={field.required}
            hint={field.hint}
            value={values[field.name] ?? ''}
            onChange={(value) => {
              set(field.name, value)
            }}
          />
        ) : (
          <Field
            key={field.name}
            label={field.label}
            name={field.name}
            required={field.required}
            hint={field.hint}
            value={values[field.name] ?? ''}
            {...(field.name === 'designation' && missing
              ? { problem: siteStructureWords.noDesignation }
              : {})}
            onChange={(event) => {
              set(field.name, event.target.value)
            }}
          />
        ),
      )}
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      <SiteActionBar note={structureWords.saved}>
        <Button wide className="flex-1 basis-0" onClick={onCancel} disabled={working}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          form={formId}
          tone="primary"
          wide
          icon={Check}
          className="flex-2 basis-0"
          disabled={working}
        >
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
      </SiteActionBar>
    </form>
  )
}

/** In place of a form for whoever does not take stock of assets. */
export function NotTaking({
  title,
  back,
}: {
  readonly title: string
  readonly back: { to: string; label: string }
}) {
  return (
    <NotOffered title={title} back={back}>
      {structureWords.mayNot}
    </NotOffered>
  )
}

/** A board added to the asset of the address, or the board of the address changed. */
export function SiteBoardFormScreen() {
  const { assetId, boardId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const boards = useBoards(assetId)
  const board = useBoardOf(assetId, boardId)
  const editing = boardId !== undefined

  if (!asset || assetId === undefined || (editing && !board)) {
    return (
      <NotOnDevice
        what={editing ? 'Diesen Verteiler' : 'Diese Anlage'}
        back={{ to: stockTaking.start, label: 'Zurück zu Aufnehmen' }}
      />
    )
  }

  const back =
    boardId === undefined
      ? { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
      : { to: structurePlaces.board(assetId, boardId), label: 'Zurück zum Verteiler' }
  const title = editing ? 'Verteiler bearbeiten' : 'Verteiler hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  return (
    <>
      <SiteHeader
        title={title}
        sub={
          editing ? `${text(board, 'designation')}, ${text(asset, 'name')}` : text(asset, 'name')
        }
        back={back}
      />
      <SiteScreen>
        <SitePartForm
          key={boardId ?? `new-${assetId}`}
          fields={boardFields}
          record={board ?? newBoard(boards)}
          submitLabel={editing ? 'Speichern' : 'Hinzufügen'}
          onCancel={() => {
            void navigate({ to: back.to })
          }}
          onSubmit={async (values) => {
            const result =
              boardId === undefined
                ? await client.create('distribution_boards', {
                    ...asBoard(values),
                    assetId,
                    position: nextPosition(boards),
                  })
                : await client.update('distribution_boards', boardId, asBoard(values))

            if (result.outcome === 'queued') {
              await navigate({ to: structurePlaces.board(assetId, result.id) })
            }

            return result
          }}
        />
      </SiteScreen>
    </>
  )
}

/** A section added to the board of the address, or the section of the address changed. */
export function SiteSectionFormScreen() {
  const { assetId, boardId, sectionId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
    sectionId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const board = useBoardOf(assetId, boardId)
  const sections = useSections(boardId)
  const section = sections.find((each) => String(each['id']) === sectionId) ?? null
  const editing = sectionId !== undefined

  if (!asset || !board || assetId === undefined || boardId === undefined || (editing && !section)) {
    return (
      <NotOnDevice
        what={editing ? 'Dieses Feld' : 'Diesen Verteiler'}
        back={
          assetId === undefined
            ? { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }
            : { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
        }
      />
    )
  }

  const back = { to: structurePlaces.board(assetId, boardId), label: 'Zurück zum Verteiler' }
  const title = editing ? `${text(section, 'designation')} bearbeiten` : 'Feld hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  return (
    <>
      <SiteHeader
        title={title}
        sub={`${text(board, 'designation')}, ${text(asset, 'name')}`}
        back={back}
      />
      <SiteScreen>
        <SitePartForm
          key={sectionId ?? `new-${boardId}`}
          fields={sectionFields}
          record={section}
          submitLabel={editing ? 'Speichern' : 'Hinzufügen'}
          onCancel={() => {
            void navigate({ to: back.to })
          }}
          onSubmit={async (values) => {
            const result =
              sectionId === undefined
                ? await client.create('board_sections', {
                    ...asSection(values),
                    distributionBoardId: boardId,
                    position: nextPosition(sections),
                  })
                : await client.update('board_sections', sectionId, asSection(values))

            if (result.outcome === 'queued') {
              await navigate({ to: back.to })
            }

            return result
          }}
        />
      </SiteScreen>
    </>
  )
}

/** The circuits of a board in one place: a section, or the board directly. */
function inSection(circuits: readonly RecordState[], section: string | null) {
  return ordered(circuits.filter((circuit) => maybeText(circuit, 'boardSectionId') === section))
}

/**
 * A circuit added to the board of the address, the board "Stromkreis
 * hinzufügen", or the circuit of the address changed in the same form,
 * filled in. A new one starts in the last section of the board, where a
 * board is usually written down to its end, and goes to the end of the
 * section it is put in; one moved to another section goes to the end of
 * that one.
 *
 * The form is the foundation's, with the units beside the fields and its
 * buttons at the foot of the screen. That bar has no place for a sentence of
 * the application, so what the board says under its buttons stands at the
 * end of the form, after the sentence about what may stay empty.
 */
export function SiteCircuitFormScreen() {
  const { assetId, boardId, circuitId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
    circuitId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const board = useBoardOf(assetId, boardId)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)
  const circuit = useCircuitOf(boardId, circuitId)
  const editing = circuitId !== undefined

  if (!asset || !board || assetId === undefined || boardId === undefined || (editing && !circuit)) {
    return (
      <NotOnDevice
        what={editing ? 'Diesen Stromkreis' : 'Diesen Verteiler'}
        back={
          assetId === undefined
            ? { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }
            : { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
        }
      />
    )
  }

  const back =
    circuitId === undefined
      ? { to: structurePlaces.board(assetId, boardId), label: 'Zurück zum Verteiler' }
      : {
          to: structurePlaces.circuit(assetId, boardId, circuitId),
          label: 'Zurück zum Stromkreis',
        }
  const title = editing ? `${text(circuit, 'designation')} bearbeiten` : 'Stromkreis hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  const known = new Set(sections.map((each) => String(each['id'])))
  const sectionOf = (values: Draft | RecordState | null): string | null => {
    const value = values?.['boardSectionId']

    return typeof value === 'string' && known.has(value) ? value : null
  }
  const last = sections.at(-1)

  async function submit(values: Draft): Promise<EditResult> {
    const target = sectionOf(values)
    const others = circuits.filter((each) => String(each['id']) !== circuitId)
    const result =
      circuitId === undefined
        ? await client.create('circuits', {
            ...values,
            distributionBoardId: boardId,
            position: nextPosition(inSection(others, target)),
          })
        : await client.update('circuits', circuitId, {
            ...values,
            ...(sectionOf(circuit) === target
              ? {}
              : { position: nextPosition(inSection(others, target)) }),
          })

    if (result.outcome === 'queued' && assetId !== undefined && boardId !== undefined) {
      await navigate({
        to:
          circuitId === undefined
            ? structurePlaces.board(assetId, boardId)
            : structurePlaces.circuit(assetId, boardId, circuitId),
      })
    }

    return result
  }

  return (
    <>
      <SiteHeader
        title={title}
        sub={`${text(board, 'designation')}, ${text(asset, 'name')}`}
        back={back}
      />
      <SiteScreen>
        <CircuitForm
          key={circuitId ?? `new-${boardId}`}
          record={circuit}
          sections={sections}
          // The section of a circuit that is there is its own, also none.
          section={editing || last === undefined ? null : String(last['id'])}
          submitLabel={editing ? 'Speichern' : 'Hinzufügen'}
          onCancel={() => {
            void navigate({ to: back.to })
          }}
          onSubmit={submit}
        />
        <SiteText muted size={15}>
          {siteStructureWords.unknownStays}
        </SiteText>
        <SiteText muted size={15}>
          {structureWords.saved}
        </SiteText>
      </SiteScreen>
    </>
  )
}

/** A piece of equipment added to the circuit of the address, or the one of the address changed. */
export function SiteEquipmentFormScreen() {
  const { assetId, boardId, circuitId, equipmentId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
    circuitId?: string
    equipmentId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const board = useBoardOf(assetId, boardId)
  const circuit = useCircuitOf(boardId, circuitId)
  const equipment = useEquipment(circuit ? circuitId : undefined)
  const item = equipment.find((each) => String(each['id']) === equipmentId) ?? null
  const editing = equipmentId !== undefined

  if (
    !asset ||
    !board ||
    !circuit ||
    assetId === undefined ||
    boardId === undefined ||
    circuitId === undefined ||
    (editing && !item)
  ) {
    return (
      <NotOnDevice
        what={editing ? 'Dieses Betriebsmittel' : 'Diesen Stromkreis'}
        back={
          assetId === undefined
            ? { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }
            : { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
        }
      />
    )
  }

  const back = {
    to: structurePlaces.circuit(assetId, boardId, circuitId),
    label: 'Zurück zum Stromkreis',
  }
  const title = editing ? `${text(item, 'designation')} bearbeiten` : 'Betriebsmittel hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  return (
    <>
      <SiteHeader
        title={title}
        sub={`${text(circuit, 'designation')}, ${text(board, 'designation')}`}
        back={back}
      />
      <SiteScreen>
        <SitePartForm
          key={equipmentId ?? `new-${circuitId}`}
          fields={equipmentFields}
          record={item}
          submitLabel={editing ? 'Speichern' : 'Hinzufügen'}
          onCancel={() => {
            void navigate({ to: back.to })
          }}
          onSubmit={async (values) => {
            const result =
              equipmentId === undefined
                ? await client.create('equipment', {
                    ...asEquipment(values),
                    circuitId,
                    position: nextPosition(equipment),
                  })
                : await client.update('equipment', equipmentId, asEquipment(values))

            if (result.outcome === 'queued') {
              await navigate({ to: back.to })
            }

            return result
          }}
        />
      </SiteScreen>
    </>
  )
}
