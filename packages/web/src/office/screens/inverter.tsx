import { modulePowerText, type RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Column, IconButton, Panel, Status } from '@opengewerk/platform-web'
import { Empty, type Fact, FactList, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecord, useRecords } from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import {
  figureOf,
  inverterPower,
  inverterWhere,
  modulesInWords,
  modulesPowerText,
  peakCell,
  pvWords,
  stringsInWords,
  useInverters,
  usePvModules,
  usePvStrings,
} from '../../app/photovoltaic.js'
import { placePath } from '../../app/place-path.js'
import { placeAbove } from '../../app/place-records.js'
import { assetRegisterPlace } from '../asset-addresses.js'
import { officePlaces } from '../place-addresses.js'
import { InverterDialog, ModuleDialog, StringDialog } from '../pv-dialogs.js'
import { useStructureMoves, withDropLine } from '../structure-reorder.js'
import { DropLine } from '../template-reorder.js'

export const inverterScreenWords = {
  notThere:
    'Diesen Wechselrichter hält dieses Gerät nicht. Entweder wurde er entfernt, er liegt außerhalb Ihrer Bereiche, oder der Abgleich steht noch aus.',
} as const

/** What the dialog over the page is for, while one is open. */
type Opened =
  | { readonly kind: 'inverter' }
  | { readonly kind: 'string'; readonly pvString: RecordState | null }
  | {
      readonly kind: 'module'
      readonly pvString: RecordState
      readonly item: RecordState | null
      readonly modules: readonly RecordState[]
    }

/** The places above an asset the device holds, for the path over a page below it. */
function usePlacesAbove(asset: RecordState | null) {
  const property = useRecord('properties', maybeText(asset, 'propertyId') ?? undefined)
  const building = useRecord('buildings', maybeText(asset, 'buildingId') ?? undefined)
  const room = useRecord('rooms', maybeText(asset, 'roomId') ?? undefined)
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)

  return { property, building, floor, room }
}

/** "MPP-Eingang 1 · 12 Module, zusammen 4,80 kWp": the input of a string and what its modules add up to. */
function stringMeta(pvString: RecordState, modules: readonly RecordState[]): string {
  const input = figureOf(pvString, 'mppInput')

  return [input === null ? null : `MPP-Eingang ${String(input)}`, modulesPowerText(modules)]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/**
 * The page of one inverter in the office (#461), the board "Wechselrichter":
 * its strings in their order, each with a table of its modules in the order
 * they were taken up, and beside them what is known of the inverter. The head
 * counts strings, modules and their power.
 *
 * Read from the device and written through the outbox, like the structure in
 * the file of the asset: whoever takes stock of assets adds, changes and moves
 * strings and modules here, a module within its string. Removing is in the
 * dialogs, for whoever keeps the assets. Without the right to take stock the
 * page only reads.
 */
export function InverterScreen() {
  const { assetId, inverterId } = useParams({ strict: false }) as {
    assetId?: string
    inverterId?: string
  }
  const navigate = useNavigate()
  const records = useRight('asset.record')
  const asset = useRecord('assets', assetId)
  const inverter = useRecord('inverters', inverterId)
  const above = usePlacesAbove(asset)
  const inverters = useInverters(assetId)
  const strings = usePvStrings(inverterId)
  const allModules = useRecords('pv_modules')
  const [opened, setOpened] = useState<Opened | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const stringMoves = useStructureMoves({
    scope: 'strings',
    entity: 'pv_strings',
    groups: [{ key: '', items: strings }],
    container: list,
  })

  if (
    !inverter ||
    assetId === undefined ||
    inverterId === undefined ||
    maybeText(inverter, 'assetId') !== assetId
  ) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[assetRegisterPlace]} />
        <Empty>{inverterScreenWords.notThere}</Empty>
      </Screen>
    )
  }

  const designation = text(inverter, 'designation')
  const assetName = asset ? text(asset, 'name') : 'Anlage'
  const toAsset = { to: officePlaces.asset(assetId), label: assetName }
  const close = () => {
    setOpened(null)
  }
  const ids = new Set(strings.map((pvString) => String(pvString['id'])))
  const modules = allModules.filter((module) => ids.has(String(module['pvStringId'])))
  const peak = peakCell(modules)
  const counted = [
    stringsInWords(strings.length),
    modules.length === 0 ? null : modulesInWords(modules.length),
    modules.length === 0 || peak === '' ? null : peak,
  ]
    .filter(Boolean)
    .join(', ')
  const [group] = stringMoves.groups

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
        badges={<Status tone="neutral">Wechselrichter</Status>}
        sub={[inverterWhere(inverter), counted].filter(Boolean).join(' · ')}
        actions={
          records ? (
            <>
              <Button
                icon={Pencil}
                onClick={() => {
                  setOpened({ kind: 'inverter' })
                }}
              >
                Bearbeiten
              </Button>
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  setOpened({ kind: 'string', pvString: null })
                }}
              >
                String hinzufügen
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Strings und Module">
          {stringMoves.trouble ? (
            <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
              {stringMoves.trouble}
            </p>
          ) : null}
          {strings.length === 0 ? (
            <p className="text-[13px] leading-[1.4] text-ink-muted">{pvWords.noStrings}</p>
          ) : (
            <div ref={list} className="flex flex-col gap-4">
              <div {...stringMoves.body('')} className="flex flex-col gap-[18px]">
                {group
                  ? withDropLine(
                      stringMoves,
                      group,
                      (pvString) => (
                        <StringBlock
                          key={String(pvString['id'])}
                          pvString={pvString}
                          handle={
                            records
                              ? stringMoves.handle(
                                  String(pvString['id']),
                                  text(pvString, 'designation'),
                                )
                              : null
                          }
                          row={stringMoves.row}
                          records={records}
                          onEdit={() => {
                            setOpened({ kind: 'string', pvString })
                          }}
                          onModule={(item, own) => {
                            setOpened({ kind: 'module', pvString, item, modules: own })
                          }}
                        />
                      ),
                      (key) => <DropLine key={key} />,
                    )
                  : null}
              </div>
              {stringMoves.said}
            </div>
          )}
        </Panel>
        <Panel title="Wechselrichter">
          <FactList keyWidth={110} facts={factsOf(inverter)} />
        </Panel>
      </div>
      {opened?.kind === 'inverter' ? (
        <InverterDialog
          assetId={assetId}
          assetName={assetName}
          inverter={inverter}
          inverters={inverters}
          strings={strings.length}
          modules={modules.length}
          onClose={close}
          onRemoved={() => navigate({ to: officePlaces.asset(assetId) })}
        />
      ) : null}
      {opened?.kind === 'string' ? (
        <StringDialog
          inverter={inverter}
          sub={`${designation}, ${assetName}`}
          pvString={opened.pvString}
          strings={strings}
          modules={
            opened.pvString
              ? modules.filter((module) => module['pvStringId'] === opened.pvString?.['id']).length
              : 0
          }
          onClose={close}
        />
      ) : null}
      {opened?.kind === 'module' ? (
        <ModuleDialog
          pvString={opened.pvString}
          sub={`${text(opened.pvString, 'designation')}, ${designation}, ${assetName}`}
          item={opened.item}
          modules={opened.modules}
          onClose={close}
        />
      ) : null}
    </Screen>
  )
}

/**
 * A string with its modules, `string_block()` of the board: the handle, its
 * name, its input and what its modules add up to, "Bearbeiten" and "Modul
 * hinzufügen", which puts the new module at the end of this string, and the
 * table of its modules, each with its handle, its place, maker, model, serial
 * number and power, and the pencil that opens its form. A module moves within
 * its string.
 */
function StringBlock({
  pvString,
  handle,
  row,
  records,
  onEdit,
  onModule,
}: {
  readonly pvString: RecordState
  readonly handle: ReactNode
  readonly row: ReturnType<typeof useStructureMoves>['row']
  readonly records: boolean
  readonly onEdit: () => void
  readonly onModule: (item: RecordState | null, modules: readonly RecordState[]) => void
}) {
  const id = String(pvString['id'])
  const name = text(pvString, 'designation')
  const modules = usePvModules(id)
  const body = useRef<HTMLTableSectionElement>(null)
  const moves = useStructureMoves({
    scope: `modules-${id}`,
    entity: 'pv_modules',
    groups: [{ key: '', items: modules }],
    container: body,
  })
  const [group] = moves.groups

  return (
    <div role="group" aria-label={name} {...row(id, '')}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1 pt-1 pb-2">
        {handle}
        <h3 className="text-[14px] font-semibold">{name}</h3>
        <span className="text-[12px] text-ink-muted">{stringMeta(pvString, modules)}</span>
        <div className="grow" />
        {records ? (
          <>
            <Button size="small" icon={Pencil} aria-label={`${name} bearbeiten`} onClick={onEdit}>
              Bearbeiten
            </Button>
            <Button
              size="small"
              icon={Plus}
              // The visible words first, so that whoever speaks to the screen
              // finds the button by what it says.
              aria-label={`Modul hinzufügen in ${name}`}
              onClick={() => {
                onModule(null, modules)
              }}
            >
              Modul hinzufügen
            </Button>
          </>
        ) : null}
      </div>
      {moves.trouble ? (
        <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
          {moves.trouble}
        </p>
      ) : null}
      {modules.length === 0 ? (
        <p className="border-t border-line px-1 py-2 text-[13px] text-ink-muted">
          {pvWords.noModules}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] text-ink">
            <caption className="sr-only">{`Module in ${name}`}</caption>
            <thead>
              <tr>
                <Column className="w-12">Nr.</Column>
                <Column>Hersteller</Column>
                <Column>Modell</Column>
                <Column>Seriennummer</Column>
                <Column numeric className="w-[74px]">
                  Leistung
                </Column>
                <Column className="w-7">
                  <span className="sr-only">Bearbeiten</span>
                </Column>
              </tr>
            </thead>
            <tbody ref={body} {...moves.body('')}>
              {group
                ? withDropLine(
                    moves,
                    group,
                    (item) => {
                      const itemId = String(item['id'])
                      const place = modules.indexOf(item) + 1
                      const what = `Modul ${String(place)} in ${name}`
                      const watts = figureOf(item, 'ratedPowerW')

                      return (
                        <tr key={itemId} {...moves.row(itemId, '')}>
                          <td className="border-b border-row py-px pr-2 pl-0.5">
                            <div className="flex items-center gap-1">
                              {records ? moves.handle(itemId, what) : null}
                              <span className="tabular-nums">{place}</span>
                            </div>
                          </td>
                          <td className="border-b border-row px-2 py-px">
                            {maybeText(item, 'manufacturer')}
                          </td>
                          <td className="border-b border-row px-2 py-px">
                            {maybeText(item, 'model')}
                          </td>
                          <td className="border-b border-row px-2 py-px tabular-nums">
                            {maybeText(item, 'serialNumber') ?? (
                              <span className="text-waiting">{pvWords.withoutSerial}</span>
                            )}
                          </td>
                          <td className="border-b border-row px-2 py-px text-right tabular-nums">
                            {watts === null ? null : modulePowerText(watts)}
                          </td>
                          <td className="border-b border-row py-px pr-0.5 pl-2 text-right">
                            {records ? (
                              <IconButton
                                label={`${what} bearbeiten`}
                                className="h-7! min-h-7! w-7! min-w-7! max-lg:h-10! max-lg:min-h-10! max-lg:w-10! max-lg:min-w-10!"
                                onClick={() => {
                                  onModule(item, modules)
                                }}
                              >
                                <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                              </IconButton>
                            ) : null}
                          </td>
                        </tr>
                      )
                    },
                    (key) => (
                      <tr key={key} aria-hidden="true">
                        <td colSpan={6} className="p-0">
                          <DropLine />
                        </td>
                      </tr>
                    ),
                  )
                : null}
            </tbody>
          </table>
          {moves.said}
        </div>
      )}
    </div>
  )
}

/** What is known of an inverter, `inverter_facts()` of the board, each only where it is. */
function factsOf(inverter: RecordState): Fact[] {
  const inputs = figureOf(inverter, 'mppInputs')

  return [
    { label: 'Hersteller', value: maybeText(inverter, 'manufacturer') },
    { label: 'Modell', value: maybeText(inverter, 'model') },
    { label: 'Seriennummer', value: maybeText(inverter, 'serialNumber') },
    { label: 'Nennleistung', value: inverterPower(inverter) },
    { label: 'MPP-Eingänge', value: inputs === null ? null : String(inputs) },
    { label: 'Ort', value: inverterWhere(inverter) },
  ]
}
