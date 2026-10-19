import {
  cableInstallationMethodName,
  cableLengthText,
  cableText,
  distributionBoardKindLabel,
  overcurrentText,
  type RecordState,
  rcdText,
} from '@opengewerk/haustechnik-domain'
import { Button, IconButton, isNarrow, Panel, Status, useBand } from '@opengewerk/platform-web'
import {
  ChangesButton,
  Empty,
  type Fact,
  FactList,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecord } from '@opengewerk/platform-web/sync'
import { Link, Navigate, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import {
  boardKindOf,
  circuitGroups,
  circuitsInWords,
  circuitSummary,
  equipmentLine,
  figuresOf,
  sectionsInWords,
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
import { assetRegisterPlace } from '../asset-addresses.js'
import { officePlaces } from '../place-addresses.js'
import {
  BoardDialog,
  CircuitDialog,
  EquipmentDialog,
  SectionDialog,
  useChart,
} from '../structure-dialogs.js'
import { type MoveGroup, useStructureMoves, withDropLine } from '../structure-reorder.js'
import { DropLine } from '../template-reorder.js'

export const boardScreenWords = {
  notThere:
    'Diesen Verteiler hält dieses Gerät nicht. Entweder wurde er entfernt, er liegt außerhalb Ihrer Bereiche, oder der Abgleich steht noch aus.',
  pick: 'Ein Stromkreis aus der Liste zeigt hier seine Angaben und Betriebsmittel.',
  circuitGone: 'Diesen Stromkreis hält dieses Gerät nicht, vielleicht wurde er gerade entfernt.',
} as const

/** What the dialog over the page is for, while one is open. */
type Opened =
  | { readonly kind: 'board' }
  | { readonly kind: 'section'; readonly section: RecordState | null }
  | {
      readonly kind: 'circuit'
      readonly circuit: RecordState | null
      readonly section: string | null
    }
  | { readonly kind: 'equipment'; readonly item: RecordState | null }

/** The places above an asset the device holds, for the path over a page below it. */
function usePlacesAbove(asset: RecordState | null) {
  const property = useRecord('properties', maybeText(asset, 'propertyId') ?? undefined)
  const building = useRecord('buildings', maybeText(asset, 'buildingId') ?? undefined)
  const room = useRecord('rooms', maybeText(asset, 'roomId') ?? undefined)
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)

  return { property, building, floor, room }
}

/** The page of a board the device does not hold, or not yet. */
function NotThere() {
  return (
    <Screen>
      <PageHead title="Nicht gefunden" crumbs={[assetRegisterPlace]} />
      <Empty>{boardScreenWords.notThere}</Empty>
    </Screen>
  )
}

/**
 * A board by its id alone (`boardLanding`), as the change log links to it:
 * the log knows the board and not the asset it hangs on, and the page lives
 * under the asset. The board on this device names its asset, and the landing
 * hands on to the page.
 */
export function BoardLandingScreen() {
  const { boardId } = useParams({ strict: false }) as { boardId?: string }
  const board = useRecord('distribution_boards', boardId)
  const assetId = maybeText(board, 'assetId')

  if (boardId === undefined || assetId === null) {
    return <NotThere />
  }

  return <Navigate to={structurePlaces.board(assetId, boardId)} replace />
}

/** A designation as the door of a board has it: condensed, at the width of "F10". */
function Designation({
  children,
  large = false,
}: {
  readonly children: string
  readonly large?: boolean
}) {
  return (
    <span
      className={`inline-block min-w-10 shrink-0 font-condensed font-semibold tracking-[0.3px] text-ink ${large ? 'text-[20px]' : 'text-[15px]'}`}
    >
      {children}
    </span>
  )
}

/**
 * The page of one board in the office (#349), the board "Verteiler": its
 * circuits section by section, those on the board directly first under "Ohne
 * Feld", in the order of the chart, and beside them the circuit chosen with
 * its equipment. The address of a circuit chooses it, so that one is handed
 * on as a link.
 *
 * Read from the device and written through the outbox, like the structure in
 * the file of the asset: whoever takes stock of assets adds, changes and moves
 * sections, circuits and equipment here, and moves a circuit into another
 * section by its handle. Removing is in the dialogs, for whoever keeps the
 * assets. Without the right to take stock the page only reads.
 */
export function BoardScreen() {
  const { assetId, boardId, circuitId } = useParams({ strict: false }) as {
    assetId?: string
    boardId?: string
    circuitId?: string
  }
  const navigate = useNavigate()
  const records = useRight('asset.record')
  const asset = useRecord('assets', assetId)
  const board = useRecord('distribution_boards', boardId)
  const above = usePlacesAbove(asset)
  const boards = useBoards(assetId)
  const sections = useSections(boardId)
  const circuits = useCircuits(boardId)
  const circuit = circuits.find((each) => String(each['id']) === circuitId) ?? null
  const equipment = useEquipment(circuit ? circuitId : undefined)
  const chart = useChart(assetId ?? '', boardId)
  const [opened, setOpened] = useState<Opened | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const items = useRef<HTMLUListElement>(null)
  const detailId = useId()
  const narrow = isNarrow(useBand())
  const groups = circuitGroups(sections, circuits)
  const nameOf = (key: string) =>
    text(
      sections.find((section) => String(section['id']) === key),
      'designation',
    )
  const sectionMoves = useStructureMoves({
    scope: 'sections',
    entity: 'board_sections',
    groups: [{ key: '', items: sections }],
    container: list,
  })
  const circuitMoves = useStructureMoves({
    scope: 'circuits',
    entity: 'circuits',
    field: 'boardSectionId',
    groups: groups.map((group) => ({ key: group.key, items: group.circuits })),
    where: (key) => (key === '' ? 'ohne Feld' : `im Feld „${nameOf(key)}“`),
    container: list,
  })
  const equipmentMoves = useStructureMoves({
    scope: 'equipment',
    entity: 'equipment',
    groups: [{ key: '', items: equipment }],
    container: items,
  })

  // Below 1024 pixels the circuit stands under the list: one chosen there
  // would open out of sight.
  useEffect(() => {
    if (circuitId !== undefined && narrow) {
      document.getElementById(detailId)?.scrollIntoView({ block: 'start' })
    }
  }, [circuitId, narrow, detailId])

  if (
    !board ||
    assetId === undefined ||
    boardId === undefined ||
    maybeText(board, 'assetId') !== assetId
  ) {
    return <NotThere />
  }

  const designation = text(board, 'designation')
  const assetName = asset ? text(asset, 'name') : 'Anlage'
  const onBoard = `${designation}, ${assetName}`
  const toAsset = { to: officePlaces.asset(assetId), label: assetName }
  const close = () => {
    setOpened(null)
  }
  const inSection = (key: string) => circuits.filter((each) => each['boardSectionId'] === key)
  const counted = [
    sections.length === 0 ? null : sectionsInWords(sections.length),
    circuitsInWords(circuits.length),
  ]
    .filter(Boolean)
    .join(', ')

  /** The circuits of one group, with the line where a dragged one lands. */
  const rowsOf = (group: MoveGroup) =>
    group.items.length === 0 ? (
      <p className="px-1 py-2 text-[13px] text-ink-muted">{structureWords.emptySection}</p>
    ) : (
      withDropLine(
        circuitMoves,
        group,
        (each) => (
          <CircuitRow
            key={String(each['id'])}
            circuit={each}
            to={structurePlaces.circuit(assetId, boardId, String(each['id']))}
            chosen={String(each['id']) === circuitId}
            handle={
              records ? circuitMoves.handle(String(each['id']), text(each, 'designation')) : null
            }
            row={circuitMoves.row}
          />
        ),
        (key) => <DropLine key={key} />,
      )
    )
  const direct = circuitMoves.groups.find((group) => group.key === '')
  const [sectionGroup] = sectionMoves.groups

  return (
    <Screen>
      <PageHead
        title={designation}
        crumbs={
          above.property
            ? placePath(
                placeAbove({
                  property: above.property,
                  building: above.building,
                  floor: above.floor,
                  room: above.room,
                  asset,
                }),
                officePlaces,
              )
            : [assetRegisterPlace, toAsset]
        }
        phoneBack={toAsset}
        badges={<Status tone="neutral">{distributionBoardKindLabel[boardKindOf(board)]}</Status>}
        sub={[maybeText(board, 'location'), counted].filter(Boolean).join(' · ')}
        actions={
          <>
            {chart.button}
            {/* For whoever reads the log, as on every page of a record: the
                board with its sections, circuits and equipment. */}
            <ChangesButton table="distribution_boards" id={boardId} />
            {records ? (
              <>
                <Button
                  icon={Pencil}
                  onClick={() => {
                    setOpened({ kind: 'board' })
                  }}
                >
                  Bearbeiten
                </Button>
                <Button
                  tone="primary"
                  icon={Plus}
                  onClick={() => {
                    setOpened({ kind: 'circuit', circuit: null, section: null })
                  }}
                >
                  Stromkreis hinzufügen
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {chart.trouble}
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Stromkreise"
          action={
            records ? (
              <Button
                size="small"
                icon={Plus}
                onClick={() => {
                  setOpened({ kind: 'section', section: null })
                }}
              >
                Feld hinzufügen
              </Button>
            ) : null
          }
        >
          {sectionMoves.trouble || circuitMoves.trouble ? (
            <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
              {sectionMoves.trouble ?? circuitMoves.trouble}
            </p>
          ) : null}
          {circuits.length === 0 && sections.length === 0 ? (
            <p className="text-[13px] leading-[1.4] text-ink-muted">{structureWords.noCircuits}</p>
          ) : (
            <div ref={list} className="flex flex-col gap-4">
              {direct ? (
                <div role="group" aria-label={structureWords.withoutSection}>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line px-1 pt-1 pb-2">
                    <h3 className="text-[14px] font-semibold">{structureWords.withoutSection}</h3>
                    <span className="text-[12px] text-ink-muted">
                      {`${circuitsInWords(direct.items.length)}, ${structureWords.direct}`}
                    </span>
                  </div>
                  <div {...circuitMoves.body('')}>{rowsOf(direct)}</div>
                </div>
              ) : null}
              <div {...sectionMoves.body('')} className="flex flex-col gap-4">
                {sectionGroup
                  ? withDropLine(
                      sectionMoves,
                      sectionGroup,
                      (section) => {
                        const id = String(section['id'])
                        const name = text(section, 'designation')
                        const group = circuitMoves.groups.find((each) => each.key === id) ?? {
                          key: id,
                          items: [],
                        }

                        return (
                          <div
                            key={id}
                            role="group"
                            aria-label={name}
                            {...sectionMoves.row(id, '')}
                          >
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line px-1 pt-1 pb-2">
                              {records ? sectionMoves.handle(id, name) : null}
                              <h3 className="text-[14px] font-semibold">{name}</h3>
                              <span className="text-[12px] text-ink-muted">
                                {circuitsInWords(group.items.length)}
                              </span>
                              <div className="grow" />
                              {records ? (
                                <>
                                  <Button
                                    size="small"
                                    icon={Pencil}
                                    aria-label={`${name} bearbeiten`}
                                    onClick={() => {
                                      setOpened({ kind: 'section', section })
                                    }}
                                  >
                                    Bearbeiten
                                  </Button>
                                  <Button
                                    size="small"
                                    icon={Plus}
                                    // The visible words first, so that whoever speaks to the
                                    // screen finds the button by what it says.
                                    aria-label={`Stromkreis hinzufügen in ${name}`}
                                    onClick={() => {
                                      setOpened({ kind: 'circuit', circuit: null, section: id })
                                    }}
                                  >
                                    Stromkreis hinzufügen
                                  </Button>
                                </>
                              ) : null}
                            </div>
                            <div {...circuitMoves.body(id)}>{rowsOf(group)}</div>
                          </div>
                        )
                      },
                      (key) => <DropLine key={key} />,
                    )
                  : null}
              </div>
              {sectionMoves.said}
              {circuitMoves.said}
            </div>
          )}
        </Panel>
        <div id={detailId} className="flex min-w-0 scroll-mt-4 flex-col gap-3.5">
          {circuit ? (
            <>
              <Panel
                title="Stromkreis"
                action={
                  records ? (
                    <Button
                      size="small"
                      icon={Pencil}
                      aria-label={`${text(circuit, 'designation')} bearbeiten`}
                      onClick={() => {
                        setOpened({
                          kind: 'circuit',
                          circuit,
                          section: maybeText(circuit, 'boardSectionId'),
                        })
                      }}
                    >
                      Bearbeiten
                    </Button>
                  ) : null
                }
              >
                <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2">
                  <Designation large>{text(circuit, 'designation')}</Designation>
                  <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">
                    {maybeText(circuit, 'consumer')}
                  </span>
                </div>
                <FactList keyWidth={120} facts={factsOf(circuit, sections)} />
              </Panel>
              <Panel title="Betriebsmittel">
                {equipmentMoves.trouble ? (
                  <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
                    {equipmentMoves.trouble}
                  </p>
                ) : null}
                <div className="flex flex-col gap-2.5">
                  {equipment.length === 0 ? (
                    <p className="text-[13px] leading-[1.4] text-ink-muted">
                      {structureWords.noEquipment}
                    </p>
                  ) : (
                    <ul ref={items} aria-label="Betriebsmittel" {...equipmentMoves.body('')}>
                      {equipmentMoves.groups[0]
                        ? withDropLine(
                            equipmentMoves,
                            equipmentMoves.groups[0],
                            (item) => {
                              const id = String(item['id'])
                              const name = text(item, 'designation')

                              return (
                                <li
                                  key={id}
                                  {...equipmentMoves.row(
                                    id,
                                    'border-b border-row',
                                    'flex items-center gap-1.5 py-1.5',
                                  )}
                                >
                                  {records ? equipmentMoves.handle(id, name) : null}
                                  <div className="min-w-0 grow leading-[1.3]">
                                    <div className="text-[14px] font-medium [overflow-wrap:anywhere]">
                                      {name}
                                    </div>
                                    <div className="text-[12px] text-ink-faint">
                                      {equipmentLine(item, ' · ')}
                                    </div>
                                  </div>
                                  {records ? (
                                    <IconButton
                                      label={`${name} bearbeiten`}
                                      className="h-7! min-h-7! w-7! min-w-7! max-lg:h-10! max-lg:min-h-10! max-lg:w-10! max-lg:min-w-10!"
                                      onClick={() => {
                                        setOpened({ kind: 'equipment', item })
                                      }}
                                    >
                                      <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                                    </IconButton>
                                  ) : null}
                                </li>
                              )
                            },
                            (key) => (
                              <li key={key} aria-hidden="true">
                                <DropLine />
                              </li>
                            ),
                          )
                        : null}
                    </ul>
                  )}
                  {equipmentMoves.said}
                  {records ? (
                    <div className="flex">
                      <Button
                        size="small"
                        icon={Plus}
                        onClick={() => {
                          setOpened({ kind: 'equipment', item: null })
                        }}
                      >
                        Betriebsmittel hinzufügen
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Panel>
            </>
          ) : (
            <Panel title="Stromkreis">
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                {circuitId === undefined ? boardScreenWords.pick : boardScreenWords.circuitGone}
              </p>
            </Panel>
          )}
        </div>
      </div>
      {opened?.kind === 'board' ? (
        <BoardDialog
          assetId={assetId}
          assetName={assetName}
          board={board}
          boards={boards}
          sections={sections.length}
          circuits={circuits.length}
          onClose={close}
          onRemoved={() => navigate({ to: officePlaces.asset(assetId) })}
        />
      ) : null}
      {opened?.kind === 'section' ? (
        <SectionDialog
          board={board}
          sub={onBoard}
          section={opened.section}
          sections={sections}
          circuits={opened.section ? inSection(String(opened.section['id'])).length : 0}
          onClose={close}
        />
      ) : null}
      {opened?.kind === 'circuit' ? (
        <CircuitDialog
          board={board}
          sub={onBoard}
          circuit={opened.circuit}
          section={opened.section}
          sections={sections}
          circuits={circuits}
          equipment={opened.circuit ? equipment.length : 0}
          onClose={close}
          onMade={(id) => navigate({ to: structurePlaces.circuit(assetId, boardId, id) })}
          onRemoved={() => navigate({ to: structurePlaces.board(assetId, boardId) })}
        />
      ) : null}
      {opened?.kind === 'equipment' && circuit ? (
        <EquipmentDialog
          circuit={circuit}
          sub={`${text(circuit, 'designation')}, ${designation}`}
          item={opened.item}
          equipment={equipment}
          onClose={close}
        />
      ) : null}
    </Screen>
  )
}

/**
 * A circuit in the list of its board, `circuit_line()` of the board: the
 * handle, the designation, what it feeds and how it is protected and wired,
 * or in the colour of waiting that nothing of that is known yet. The row
 * opens it beside the list; the one open is marked.
 */
function CircuitRow({
  circuit,
  to,
  chosen,
  handle,
  row,
}: {
  readonly circuit: RecordState
  readonly to: string
  readonly chosen: boolean
  readonly handle: ReactNode
  readonly row: ReturnType<typeof useStructureMoves>['row']
}) {
  const id = String(circuit['id'])
  const summary = circuitSummary(circuit)

  return (
    <div
      {...row(
        id,
        chosen
          ? 'border-b border-row bg-selected shadow-[inset_3px_0_0_var(--color-copper)]'
          : 'border-b border-row',
        'flex items-center gap-2 py-1.5 pr-2 pl-1',
      )}
    >
      {handle}
      {/* The router marks the link of the circuit open as the current page. */}
      <Link to={to} className="flex min-w-0 grow items-center gap-2.5 text-ink no-underline">
        <Designation>{text(circuit, 'designation')}</Designation>{' '}
        <span className="min-w-0 leading-[1.35]">
          <span className="block text-[13px] font-medium [overflow-wrap:anywhere]">
            {maybeText(circuit, 'consumer')}
          </span>
          <span
            className={`block text-[12px] ${summary === null ? 'text-waiting' : 'text-ink-faint'}`}
          >
            {summary === null ? structureWords.nothingKnown : <CircuitSummary summary={summary} />}
          </span>
        </span>
      </Link>
    </div>
  )
}

/**
 * What the chart prints of a circuit, `circuit_card()` of the board: every
 * column, and what is not known says so in words.
 */
function factsOf(circuit: RecordState, sections: readonly RecordState[]): Fact[] {
  const figures = figuresOf(circuit)
  const section = sections.find((each) => each['id'] === circuit['boardSectionId'])

  return [
    {
      label: 'Feld',
      value: section ? text(section, 'designation') : structureWords.withoutSection,
    },
    { label: 'Verbraucher', value: maybeText(circuit, 'consumer') },
    { label: 'Schutzeinrichtung', value: overcurrentText(figures) },
    { label: 'RCD', value: rcdText(figures) },
    { label: 'Leitung', value: cableText(figures) },
    { label: 'Länge', value: cableLengthText(figures) },
    {
      label: 'Verlegeart',
      value:
        figures.cableInstallationMethod === null
          ? null
          : cableInstallationMethodName[figures.cableInstallationMethod],
    },
  ]
}
