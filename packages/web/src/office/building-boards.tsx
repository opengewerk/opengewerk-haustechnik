import {
  boardAssetKind,
  byNumberIn,
  distributionBoardKindLabel,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Dialog, Panel, TablePanel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecords } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { boardBuildingsOf } from '../app/board-places.js'
import { boardKindOf, structurePlaces, useBoards } from '../app/electrical.js'
import { titleOfRoom } from '../app/place-records.js'
import { officePlaces } from './place-addresses.js'
import { BoardDialog } from './structure-dialogs.js'

export const buildingBoardsWords = {
  caption: 'Verteiler in diesem Gebäude mit ihrer Niederspannungsanlage und ihrem Raum',
  none: 'Noch kein Verteiler in diesem Gebäude.',
  choose: 'Unter welcher Niederspannungsanlage?',
  chooseSub:
    'Mehrere Anlagen stehen in diesem Gebäude oder versorgen es. Der Verteiler hängt unter einer.',
} as const

/**
 * "Verteiler" on the page of a building or a room (#495): every board that
 * stands there, of whichever low-voltage installation, with the installation
 * and the room, its designation the way to its page. Where an installation
 * stands in the building or supplies it, "Verteiler aufnehmen" adds one
 * there; with several, the dialog asks under which first, with one it is
 * that one.
 *
 * Read from the device, like the card in the file of an installation: boards
 * are taken down without a network as well.
 */
export function BuildingBoardsCard({
  buildingId,
  roomId = null,
}: {
  readonly buildingId: string
  /** On the page of a room, its boards only, and a new one in it. */
  readonly roomId?: string | null
}) {
  const records = useRight('asset.record')
  const boards = useRecords('distribution_boards')
  const assets = useRecords('assets')
  const supplies = useRecords('asset_supplies')
  const rooms = useRecords('rooms')
  const circuits = useRecords('circuits')
  const [choosing, setChoosing] = useState(false)
  const [adding, setAdding] = useState<RecordState | null>(null)

  const here = useMemo(
    () =>
      boards
        .filter(
          (board) =>
            board['buildingId'] === buildingId &&
            !board['deletedAt'] &&
            (roomId === null || board['roomId'] === roomId),
        )
        .sort((left, right) =>
          byNumberIn(
            { number: text(left, 'designation'), name: null },
            { number: text(right, 'designation'), name: null },
          ),
        ),
    [boards, buildingId, roomId],
  )
  const installations = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset['kind'] === boardAssetKind &&
          !asset['deletedAt'] &&
          boardBuildingsOf(asset, supplies, rooms).includes(buildingId),
      ),
    [assets, supplies, rooms, buildingId],
  )

  // A room shows the card only for the boards in it: a building with an
  // installation has many rooms, and a new board is added on its page.
  if (here.length === 0 && (roomId !== null || installations.length === 0)) {
    return null
  }

  const assetOf = (board: RecordState) => assets.find((asset) => asset['id'] === board['assetId'])
  const roomOf = (board: RecordState) => {
    const room = rooms.find((each) => each['id'] === board['roomId'])

    return room ? titleOfRoom(room) : null
  }
  const countOf = (board: RecordState) =>
    circuits.filter((circuit) => circuit['distributionBoardId'] === board['id']).length

  const action =
    records && installations.length > 0 && roomId === null ? (
      <Button
        size="small"
        icon={Plus}
        onClick={() => {
          if (installations.length === 1) {
            setAdding(installations[0] ?? null)
          } else {
            setChoosing(true)
          }
        }}
      >
        Verteiler aufnehmen
      </Button>
    ) : null

  const dialogs = (
    <>
      {choosing ? (
        <Dialog
          title={buildingBoardsWords.choose}
          sub={buildingBoardsWords.chooseSub}
          width={520}
          onClose={() => {
            setChoosing(false)
          }}
        >
          <div className="flex flex-col gap-2">
            {installations.map((installation) => (
              <Button
                key={String(installation['id'])}
                onClick={() => {
                  setChoosing(false)
                  setAdding(installation)
                }}
              >
                {text(installation, 'name')}
              </Button>
            ))}
          </div>
        </Dialog>
      ) : null}
      {adding ? (
        <InstallationBoardDialog
          installation={adding}
          buildingId={buildingId}
          roomId={roomId}
          onClose={() => {
            setAdding(null)
          }}
        />
      ) : null}
    </>
  )

  if (here.length === 0) {
    return (
      <>
        <Panel title="Verteiler" action={action}>
          <p className="text-[13px] leading-[1.4] text-ink-muted">{buildingBoardsWords.none}</p>
        </Panel>
        {dialogs}
      </>
    )
  }

  return (
    <>
      <TablePanel
        title="Verteiler"
        action={action}
        caption={buildingBoardsWords.caption}
        cards={here.map((board) => {
          const asset = assetOf(board)
          const id = String(board['id'])

          return {
            key: id,
            title: (
              <Link to={structurePlaces.board(String(board['assetId']), id)} className={cardLink}>
                {text(board, 'designation')}
              </Link>
            ),
            sub: [
              distributionBoardKindLabel[boardKindOf(board)],
              asset ? text(asset, 'name') : null,
              roomOf(board),
              maybeText(board, 'location'),
            ]
              .filter(Boolean)
              .join(' · '),
            right: String(countOf(board)),
          }
        })}
      >
        <thead>
          <tr>
            <Column className="min-w-[150px]">Verteiler</Column>
            <Column className="min-w-[160px]">Niederspannungsanlage</Column>
            <Column className="w-[180px] min-w-[120px]">Raum</Column>
            <Column numeric className="w-[104px] min-w-[90px]">
              Stromkreise
            </Column>
          </tr>
        </thead>
        <tbody>
          {here.map((board) => {
            const asset = assetOf(board)
            const id = String(board['id'])
            const room = roomOf(board)
            const location = maybeText(board, 'location')

            return (
              <tr key={id}>
                <Cell>
                  <div className="leading-[1.3]">
                    <div className="font-medium">
                      <Link to={structurePlaces.board(String(board['assetId']), id)}>
                        {text(board, 'designation')}
                      </Link>
                    </div>
                    <div className="text-[12px] text-ink-faint">
                      {distributionBoardKindLabel[boardKindOf(board)]}
                    </div>
                  </div>
                </Cell>
                <Cell>
                  {asset ? (
                    <Link to={officePlaces.asset(String(asset['id']))}>{text(asset, 'name')}</Link>
                  ) : null}
                </Cell>
                <Cell>
                  <div className="leading-[1.3]">
                    <div className={room ? undefined : 'text-ink-faint'}>
                      {room ?? 'kein Raum angegeben'}
                    </div>
                    {location ? <div className="text-[12px] text-ink-faint">{location}</div> : null}
                  </div>
                </Cell>
                <Cell numeric>{String(countOf(board))}</Cell>
              </tr>
            )
          })}
        </tbody>
      </TablePanel>
      {dialogs}
    </>
  )
}

/** The dialog of a new board under an installation, standing in this building and room. */
function InstallationBoardDialog({
  installation,
  buildingId,
  roomId,
  onClose,
}: {
  readonly installation: RecordState
  readonly buildingId: string
  readonly roomId: string | null
  readonly onClose: () => void
}) {
  const assetId = String(installation['id'])
  const boards = useBoards(assetId)

  return (
    <BoardDialog
      assetId={assetId}
      assetName={text(installation, 'name')}
      building={buildingId}
      room={roomId}
      boards={boards}
      onClose={onClose}
    />
  )
}
