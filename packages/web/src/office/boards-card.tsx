import { distributionBoardKindLabel, type RecordState } from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  boardKindOf,
  sectionsInWords,
  structurePlaces,
  structureWords,
  useBoards,
} from '../app/electrical.js'
import { BoardDialog, useChart } from './structure-dialogs.js'
import { useStructureMoves, withDropLine } from './structure-reorder.js'
import { DropLine } from './template-reorder.js'

export const boardsCardWords = {
  caption: 'Verteiler dieser Anlage mit Ort und Zahl der Stromkreise',
  order:
    'Im Stromkreisverzeichnis bekommt jeder Verteiler ein Blatt für seine Tür, in dieser Reihenfolge.',
  none: 'keiner',
} as const

/** "Hauptverteilung, 3 Felder": what a board is, under its designation. */
function boardLine(board: RecordState, sections: number): string {
  return [
    distributionBoardKindLabel[boardKindOf(board)],
    sections === 0 ? null : sectionsInWords(sections),
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/**
 * "Verteiler" in the file of a low-voltage installation, the card of the
 * board "Anlagenakte mit Verteilern" (#349): the boards in their order, each
 * with its kind, its sections, where it hangs and how many circuits it has,
 * its designation the way to its page. The handle moves a board, and the
 * order is the order of the sheets in the circuit chart, which the button in
 * the head prints for every board.
 *
 * Read from the device, like the structure below it: the boards are taken
 * down on site as well, without a network, and stand here before they reach
 * the server. The chart is printed by the server and misses what has not
 * reached it yet, which the card then says.
 */
export function AssetBoardsCard({
  assetId,
  assetName,
}: {
  readonly assetId: string
  /** The asset by its name, for the heading of the dialog of a new board. */
  readonly assetName: string
}) {
  const client = useSync()
  const records = useRight('asset.record')
  const boards = useBoards(assetId)
  const sections = useRecords('board_sections')
  const circuits = useRecords('circuits')
  const body = useRef<HTMLTableSectionElement>(null)
  const moves = useStructureMoves({
    scope: 'boards',
    entity: 'distribution_boards',
    groups: [{ key: '', items: boards }],
    container: body,
  })
  const chart = useChart(assetId, undefined, 'small')
  const [adding, setAdding] = useState(false)
  const ids = new Set(boards.map((board) => String(board['id'])))
  const of = (records: readonly RecordState[], id: string) =>
    records.filter((record) => record['distributionBoardId'] === id).length
  const waiting = (entity: string, parts: readonly RecordState[]) =>
    parts.some(
      (part) =>
        (entity === 'distribution_boards' || ids.has(String(part['distributionBoardId']))) &&
        client.isPending(entity, String(part['id'])),
    )
  const pending =
    waiting('distribution_boards', boards) ||
    waiting('board_sections', sections) ||
    waiting('circuits', circuits)

  const action = (
    <>
      {chart.button}
      {records ? (
        <Button
          size="small"
          icon={Plus}
          onClick={() => {
            setAdding(true)
          }}
        >
          Verteiler hinzufügen
        </Button>
      ) : null}
    </>
  )
  const dialog = adding ? (
    <BoardDialog
      assetId={assetId}
      assetName={assetName}
      boards={boards}
      onClose={() => {
        setAdding(false)
      }}
    />
  ) : null
  const notes = (
    <>
      {moves.trouble ? (
        <p role="alert" className="mb-1 font-semibold text-conflict">
          {moves.trouble}
        </p>
      ) : null}
      <p>{boardsCardWords.order}</p>
      {pending ? <p className="mt-1">{structureWords.notSentInChart}</p> : null}
      {moves.said}
    </>
  )

  if (boards.length === 0) {
    return (
      <>
        {chart.trouble}
        <Panel title="Verteiler" action={action}>
          <p className="text-[13px] leading-[1.4] text-ink-muted">{structureWords.noBoards}</p>
        </Panel>
        {dialog}
      </>
    )
  }

  const [group] = moves.groups

  return (
    <>
      {chart.trouble}
      <TablePanel
        title="Verteiler"
        action={action}
        caption={boardsCardWords.caption}
        note={notes}
        cards={boards.map((board) => {
          const id = String(board['id'])
          const count = of(circuits, id)

          return {
            key: id,
            title: (
              <Link to={structurePlaces.board(assetId, id)} className={cardLink}>
                {text(board, 'designation')}
              </Link>
            ),
            sub: [boardLine(board, of(sections, id)), maybeText(board, 'location')]
              .filter(Boolean)
              .join(' · '),
            right: count === 0 ? boardsCardWords.none : String(count),
          }
        })}
      >
        <thead>
          <tr>
            <Column className="min-w-[180px]">Verteiler</Column>
            <Column className="w-[220px] min-w-[140px]">Ort</Column>
            <Column numeric className="w-[104px] min-w-[90px]">
              Stromkreise
            </Column>
          </tr>
        </thead>
        <tbody ref={body} {...moves.body('')}>
          {group
            ? withDropLine(
                moves,
                group,
                (board) => {
                  const id = String(board['id'])
                  const designation = text(board, 'designation')
                  const count = of(circuits, id)

                  return (
                    <tr key={id} {...moves.row(id, '')}>
                      <Cell>
                        <div className="flex items-center gap-1.5">
                          {records ? moves.handle(id, designation) : null}
                          <div className="min-w-0 leading-[1.3]">
                            <div className="font-medium">
                              <Link to={structurePlaces.board(assetId, id)}>{designation}</Link>
                            </div>
                            <div className="text-[12px] text-ink-faint">
                              {boardLine(board, of(sections, id))}
                            </div>
                          </div>
                        </div>
                      </Cell>
                      <Cell>{maybeText(board, 'location')}</Cell>
                      <Cell numeric className={count === 0 ? 'text-ink-faint' : undefined}>
                        {count === 0 ? boardsCardWords.none : String(count)}
                      </Cell>
                    </tr>
                  )
                },
                (key) => (
                  <tr key={key} aria-hidden="true">
                    <td colSpan={3} className="p-0">
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
