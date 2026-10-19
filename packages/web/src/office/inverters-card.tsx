import { type RecordState } from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { text, useRecords } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  inverterWhat,
  inverterWhere,
  modulesInWords,
  peakCell,
  pvPlaces,
  pvWords,
  useInverters,
} from '../app/photovoltaic.js'
import { InverterDialog } from './pv-dialogs.js'
import { useStructureMoves, withDropLine } from './structure-reorder.js'
import { DropLine } from './template-reorder.js'

export const invertersCardWords = {
  caption: 'Wechselrichter dieser Anlage mit Ort, Zahl der Strings und Leistung der Module',
} as const

/**
 * "Wechselrichter" in the file of a PV installation, the card of the board
 * "Anlagenakte einer PV-Anlage" (#461): the inverters in their order, each
 * with what it is, where it hangs, how many strings it has and what its
 * modules add up to, its designation the way to its page. The handle moves an
 * inverter. The figures of strings and modules are counted; nobody types them.
 *
 * Read from the device, like the structure below it: the inverters are taken
 * up on site as well, without a network, and stand here before they reach
 * the server.
 */
export function AssetInvertersCard({
  assetId,
  assetName,
}: {
  readonly assetId: string
  /** The asset by its name, for the heading of the dialog of a new inverter. */
  readonly assetName: string
}) {
  const records = useRight('asset.record')
  const inverters = useInverters(assetId)
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')
  const body = useRef<HTMLTableSectionElement>(null)
  const moves = useStructureMoves({
    scope: 'inverters',
    entity: 'inverters',
    groups: [{ key: '', items: inverters }],
    container: body,
  })
  const [adding, setAdding] = useState(false)
  const stringsOf = (id: string) => strings.filter((pvString) => pvString['inverterId'] === id)
  const modulesOf = (id: string) => {
    const own = new Set(stringsOf(id).map((pvString) => String(pvString['id'])))

    return modules.filter((module) => own.has(String(module['pvStringId'])))
  }
  /** "9,60 kWp" over "24 Module", or the count alone where no module has a figure. */
  const power = (own: readonly RecordState[]) => ({
    peak: peakCell(own),
    count: modulesInWords(own.length),
  })

  const action = records ? (
    <Button
      size="small"
      icon={Plus}
      onClick={() => {
        setAdding(true)
      }}
    >
      Wechselrichter hinzufügen
    </Button>
  ) : null
  const dialog = adding ? (
    <InverterDialog
      assetId={assetId}
      assetName={assetName}
      inverters={inverters}
      onClose={() => {
        setAdding(false)
      }}
    />
  ) : null

  if (inverters.length === 0) {
    return (
      <>
        <Panel title="Wechselrichter" action={action}>
          <p className="text-[13px] leading-[1.4] text-ink-muted">{pvWords.noInverters}</p>
        </Panel>
        {dialog}
      </>
    )
  }

  const [group] = moves.groups

  return (
    <>
      <TablePanel
        title="Wechselrichter"
        action={action}
        caption={invertersCardWords.caption}
        note={
          <>
            {moves.trouble ? (
              <p role="alert" className="mb-1 font-semibold text-conflict">
                {moves.trouble}
              </p>
            ) : null}
            <p>{pvWords.summed}</p>
            {moves.said}
          </>
        }
        cards={inverters.map((inverter) => {
          const id = String(inverter['id'])
          const { peak, count } = power(modulesOf(id))

          return {
            key: id,
            title: (
              <Link to={pvPlaces.inverter(assetId, id)} className={cardLink}>
                {text(inverter, 'designation')}
              </Link>
            ),
            sub: [inverterWhat(inverter), inverterWhere(inverter)].filter(Boolean).join(' · '),
            right: peak === '' ? count : `${peak}, ${count}`,
          }
        })}
      >
        <thead>
          <tr>
            <Column className="min-w-[180px]">Wechselrichter</Column>
            <Column className="w-[170px] min-w-[130px]">Ort</Column>
            <Column numeric className="w-[72px] min-w-[64px]">
              Strings
            </Column>
            <Column numeric className="w-[110px] min-w-[96px]">
              Leistung
            </Column>
          </tr>
        </thead>
        <tbody ref={body} {...moves.body('')}>
          {group
            ? withDropLine(
                moves,
                group,
                (inverter) => {
                  const id = String(inverter['id'])
                  const designation = text(inverter, 'designation')
                  const { peak, count } = power(modulesOf(id))

                  return (
                    <tr key={id} {...moves.row(id, '')}>
                      <Cell>
                        <div className="flex items-center gap-1.5">
                          {records ? moves.handle(id, designation) : null}
                          <div className="min-w-0 leading-[1.3]">
                            <div className="font-medium">
                              <Link to={pvPlaces.inverter(assetId, id)}>{designation}</Link>
                            </div>
                            <div className="text-[12px] text-ink-faint">
                              {inverterWhat(inverter)}
                            </div>
                          </div>
                        </div>
                      </Cell>
                      <Cell>{inverterWhere(inverter)}</Cell>
                      <Cell numeric>{String(stringsOf(id).length)}</Cell>
                      <Cell numeric>
                        <div className="leading-[1.3]">
                          {peak === '' ? null : <div>{peak}</div>}
                          <div className="text-[12px] text-ink-faint">{count}</div>
                        </div>
                      </Cell>
                    </tr>
                  )
                },
                (key) => (
                  <tr key={key} aria-hidden="true">
                    <td colSpan={4} className="p-0">
                      <DropLine />
                    </td>
                  </tr>
                ),
              )
            : null}
        </tbody>
      </TablePanel>
      {dialog}
    </>
  )
}
