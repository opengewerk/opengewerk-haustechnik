import { distributionBoardKindLabel, type RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { NotSent, SiteRow, SiteRows, SiteText } from '@opengewerk/platform-web/site'
import { maybeText, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type ReactNode } from 'react'

import {
  boardKindOf,
  circuitsInWords,
  sectionsInWords,
  structurePlaces,
  structureWords,
  useBoards,
} from '../../app/electrical.js'
import { titleOfRoom } from '../../app/place-records.js'
import { siteStructure } from '../places.js'

/**
 * The block "Verteiler" on the page of a low-voltage installation on site
 * (#349), and what it shares with the pages of the structure in `boards.tsx`.
 *
 * It lives apart from those pages so that the page of an asset fetches it
 * alone, and only for a low-voltage installation; the router fetches the
 * pages when their address is opened. Neither is in the entry on site, which
 * keeps it under its budget (`scripts/budget.js`), and the service worker
 * holds both, so they open without a network as well.
 */

export const siteStructureWords = {
  unknownStays: 'Was nicht bekannt ist, bleibt leer und lässt sich später ergänzen.',
  noDesignation: 'Die Bezeichnung fehlt.',
  notKept: 'Auf diesem Gerät ließ sich das nicht speichern. Die Eingaben stehen noch da.',
  noCircuit: 'noch kein Stromkreis',
} as const

/** "Unterverteilung, E.01 Werkstatt, an der Tür": what a board is and where it hangs. */
export function boardWhere(board: RecordState): string {
  return [distributionBoardKindLabel[boardKindOf(board)], maybeText(board, 'location')]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/** "2 Felder, 10 Stromkreise", "6 Stromkreise", "noch kein Stromkreis". */
function boardCounts(sections: number, circuits: number): string {
  return [
    sections === 0 ? null : sectionsInWords(sections),
    circuits === 0 ? siteStructureWords.noCircuit : circuitsInWords(circuits),
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/** A count at the right of the head of a card. */
export function Count({ total }: { readonly total: number }) {
  return <span className="text-[15px] text-ink-muted tabular-nums">{total}</span>
}

/**
 * A button under a list that goes to the form of a part, 48 pixels as the
 * boards draw it. `label` names it where the same words stand more than once
 * on a page, its visible words first.
 */
export function FormButton({
  to,
  icon,
  label,
  children,
}: {
  readonly to: string
  readonly icon: typeof Plus
  readonly label?: string
  readonly children: ReactNode
}) {
  const navigate = useNavigate()

  return (
    <Button
      wide
      height={48}
      icon={icon}
      {...(label === undefined ? {} : { 'aria-label': label })}
      onClick={() => {
        void navigate({ to })
      }}
    >
      {children}
    </Button>
  )
}

/**
 * The boards of a low-voltage installation on the page of the asset, the
 * block "Verteiler" right under the path: each with what it is, where it
 * hangs and what it holds, the way to its page, and the way to one more.
 */
export function SiteBoardsBlock({ assetId }: { readonly assetId: string }) {
  const client = useSync()
  const records = useRight('asset.record')
  const boards = useBoards(assetId)
  const sections = useRecords('board_sections')
  const circuits = useRecords('circuits')
  const of = (parts: readonly RecordState[], id: string) =>
    parts.filter((part) => part['distributionBoardId'] === id).length

  return (
    <Panel title="Verteiler" action={boards.length === 0 ? null : <Count total={boards.length} />}>
      <div className="flex flex-col gap-2.5">
        {boards.length === 0 ? (
          <SiteText muted>{structureWords.noBoards}</SiteText>
        ) : (
          <SiteRows label="Verteiler">
            {boards.map((board) => {
              const id = String(board['id'])

              return (
                <SiteRow
                  key={id}
                  to={structurePlaces.board(assetId, id)}
                  title={text(board, 'designation')}
                  meta={
                    <>
                      <span className="block">{boardWhere(board)}</span>
                      <span className="block">
                        {boardCounts(of(sections, id), of(circuits, id))}
                        {client.isPending('distribution_boards', id) ? (
                          <>
                            {', '}
                            <NotSent />
                          </>
                        ) : null}
                      </span>
                    </>
                  }
                />
              )
            })}
          </SiteRows>
        )}
        {records ? (
          <FormButton to={siteStructure.newBoard(assetId)} icon={Plus}>
            Verteiler hinzufügen
          </FormButton>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * The block "Verteiler" on the page of a building on site (#495): the boards
 * that stand in it, of whichever low-voltage installation, each with its
 * installation and room, the way to its page, and for every installation
 * that stands in the building or supplies it the way to one more there.
 */
export function SiteBuildingBoardsBlock({
  buildingId,
  installations,
}: {
  readonly buildingId: string
  /** The installations a board in this building may hang on. */
  readonly installations: readonly RecordState[]
}) {
  const client = useSync()
  const records = useRight('asset.record')
  const boards = useRecords('distribution_boards').filter(
    (board) => board['buildingId'] === buildingId && !board['deletedAt'],
  )
  const assets = useRecords('assets')
  const rooms = useRecords('rooms')
  const circuits = useRecords('circuits')

  return (
    <Panel title="Verteiler" action={boards.length === 0 ? null : <Count total={boards.length} />}>
      <div className="flex flex-col gap-2.5">
        {boards.length === 0 ? (
          <SiteText muted>Noch kein Verteiler in diesem Gebäude.</SiteText>
        ) : (
          <SiteRows label="Verteiler in diesem Gebäude">
            {boards.map((board) => {
              const id = String(board['id'])
              const assetId = String(board['assetId'])
              const asset = assets.find((each) => each['id'] === assetId)
              const room = rooms.find((each) => each['id'] === board['roomId'])

              return (
                <SiteRow
                  key={id}
                  to={structurePlaces.board(assetId, id)}
                  title={text(board, 'designation')}
                  meta={
                    <>
                      {[asset ? text(asset, 'name') : null, room ? titleOfRoom(room) : null]
                        .filter(Boolean)
                        .join(', ')}
                      {' · '}
                      <span>
                        {boardWhere(board)}
                        {', '}
                        {circuitsOrNone(
                          circuits.filter((circuit) => circuit['distributionBoardId'] === id)
                            .length,
                        )}
                        {client.isPending('distribution_boards', id) ? (
                          <>
                            {', '}
                            <NotSent />
                          </>
                        ) : null}
                      </span>
                    </>
                  }
                />
              )
            })}
          </SiteRows>
        )}
        {records
          ? installations.map((installation) => {
              const assetId = String(installation['id'])

              return (
                <FormButton
                  key={assetId}
                  to={`${siteStructure.newBoard(assetId)}?gebaeude=${encodeURIComponent(buildingId)}`}
                  icon={Plus}
                  {...(installations.length > 1
                    ? { label: `Verteiler unter ${text(installation, 'name')} aufnehmen` }
                    : {})}
                >
                  {installations.length > 1
                    ? `Verteiler unter ${text(installation, 'name')}`
                    : 'Verteiler aufnehmen'}
                </FormButton>
              )
            })
          : null}
      </div>
    </Panel>
  )
}

/** "6 Stromkreise" or "noch kein Stromkreis". */
function circuitsOrNone(total: number): string {
  return total === 0 ? siteStructureWords.noCircuit : circuitsInWords(total)
}

/**
 * The boards that stand in a room, of whichever installation (#495, #570),
 * each to its page; a new one is taken down at the building. The room shows
 * the panel only where one stands.
 */
export function SiteRoomBoardsBlock({ roomId }: { readonly roomId: string }) {
  const client = useSync()
  const boards = useRecords('distribution_boards').filter(
    (board) => board['roomId'] === roomId && !board['deletedAt'],
  )
  const assets = useRecords('assets')
  const circuits = useRecords('circuits')

  return (
    <Panel title="Verteiler" action={<Count total={boards.length} />}>
      <SiteRows label="Verteiler in diesem Raum">
        {boards.map((board) => {
          const id = String(board['id'])
          const assetId = String(board['assetId'])
          const asset = assets.find((each) => each['id'] === assetId)

          return (
            <SiteRow
              key={id}
              to={structurePlaces.board(assetId, id)}
              title={text(board, 'designation')}
              meta={
                <>
                  {asset ? text(asset, 'name') : null}
                  {' · '}
                  <span>
                    {boardWhere(board)}
                    {', '}
                    {circuitsOrNone(
                      circuits.filter((circuit) => circuit['distributionBoardId'] === id).length,
                    )}
                    {client.isPending('distribution_boards', id) ? (
                      <>
                        {', '}
                        <NotSent />
                      </>
                    ) : null}
                  </span>
                </>
              }
            />
          )
        })}
      </SiteRows>
    </Panel>
  )
}
