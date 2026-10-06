import type { RecordState } from '@opengewerk/haustechnik-domain'
import { Panel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import {
  ContactList,
  SiteActionBar,
  SiteCrumbs,
  SiteHeader,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  TopTitle,
} from '@opengewerk/platform-web/site'
import { maybeText, text, useRecord, useRecords } from '@opengewerk/platform-web/sync'
import { useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

import { placePath } from '../../app/place-path.js'
import { byLevel, byNumber, kindsOf, placeAbove, titleOfRoom } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { SiteDocuments } from '../documents.js'
import {
  assetTitle,
  byName,
  countWords,
  GoButton,
  isOpenDefect,
  kindWords,
  NotOnDevice,
  OpenDefects,
} from '../kit.js'
import { sitePlaces, stockTaking } from '../places.js'

/**
 * The plain pages of the places on site (#99, 4.1 of the concept: "Vor Ort
 * hat jede Ebene eine schlichte Seite mit dem, was darunter liegt, ohne
 * Lagebild"): the property with its buildings and the people to talk to, the
 * building with its floors, the floor with its rooms, and the room with what
 * stands in it. Each under the path that leads up, the same words as in the
 * office, and each read from the device, so that it stands without a network.
 *
 * To read, and to take stock from: a building and a room offer "Anlage
 * aufnehmen", a floor "Raum aufnehmen", to whoever holds the right. Property,
 * building and floor themselves are the office's, with a connection.
 */

const backToStart = { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }

/** "SH · Schule oder Hochschule": the short code of a building and what it is used as. */
function buildingLine(building: RecordState): string {
  return [maybeText(building, 'shortCode'), kindsOf(building).join(', ')]
    .filter((part) => part !== null && part !== '')
    .join(' · ')
}

/** The buildings of a property as rows that lead to their pages. */
function BuildingRows({ buildings }: { readonly buildings: readonly RecordState[] }) {
  return (
    <SiteRows label="Gebäude">
      {buildings.map((building) => (
        <SiteRow
          key={String(building['id'])}
          to={sitePlaces.building(String(building['id']))}
          title={text(building, 'name')}
          meta={buildingLine(building)}
        />
      ))}
    </SiteRows>
  )
}

const noBuilding = 'Noch kein Gebäude. Gebäude legt das Büro an.'

/**
 * The start of taking stock, the tab "Aufnehmen" (board "Aufnehmen: wo"):
 * the buildings the device holds, by property. Rooms and assets are taken in
 * on the page of their place, so the way there begins here.
 */
export function StockStartScreen() {
  const properties = [...useRecords('properties')].sort(byName)
  const buildings = useRecords('buildings')

  return (
    <SiteScreen>
      <TopTitle over="Bestandsaufnahme" title="Aufnehmen" />
      <SiteText>
        In welchem Gebäude nehmen Sie auf? Räume und Anlagen legen Sie auf seiner Seite an, auch
        ohne Netz.
      </SiteText>
      {properties.length === 0 ? (
        <Panel>
          <SiteText muted>
            Dieses Gerät hält keine Liegenschaft. Liegenschaften legt das Büro an, und ein Gerät
            hält die seiner Bereiche.
          </SiteText>
        </Panel>
      ) : null}
      {properties.map((property) => {
        const own = buildings.filter((each) => each['propertyId'] === property['id']).sort(byName)

        return (
          <Panel key={String(property['id'])} title={text(property, 'name')}>
            {own.length === 0 ? (
              <SiteText muted>{noBuilding}</SiteText>
            ) : (
              <BuildingRows buildings={own} />
            )}
          </Panel>
        )
      })}
    </SiteScreen>
  )
}

/** A property on site: what to know before the way there, its buildings, and whom to call. */
export function SitePropertyScreen() {
  const { propertyId } = useParams({ strict: false }) as { propertyId?: string }
  const property = useRecord('properties', propertyId)
  const buildings = useRecords('buildings')
    .filter((each) => each['propertyId'] === propertyId)
    .sort(byName)
  const contacts = useRecords('contacts').filter((each) => each['propertyId'] === propertyId)

  if (!property) {
    return <NotOnDevice what="Diese Liegenschaft" back={backToStart} />
  }

  const address = [
    maybeText(property, 'street'),
    [maybeText(property, 'postalCode'), maybeText(property, 'city')].filter(Boolean).join(' '),
  ]
    .filter((part) => part !== null && part !== '')
    .join(', ')
  const note = maybeText(property, 'note')

  return (
    <>
      <SiteHeader title={text(property, 'name')} sub={address} back={backToStart} />
      <SiteScreen>
        {note ? (
          <Panel title="Vor dem Weg">
            <SiteText>{note}</SiteText>
          </Panel>
        ) : null}
        <Panel title="Gebäude">
          {buildings.length === 0 ? (
            <SiteText muted>{noBuilding}</SiteText>
          ) : (
            <BuildingRows buildings={buildings} />
          )}
        </Panel>
        <Panel title="Ansprechpartner">
          <ContactList
            contacts={contacts}
            empty="Für diese Liegenschaft ist niemand eingetragen."
          />
        </Panel>
      </SiteScreen>
    </>
  )
}

/** A building on site: its floors, the assets that stand in no room, and "Anlage aufnehmen". */
export function SiteBuildingScreen() {
  const { buildingId } = useParams({ strict: false }) as { buildingId?: string }
  const building = useRecord('buildings', buildingId)
  const property = useRecord('properties', maybeText(building, 'propertyId') ?? undefined)
  const floors = useRecords('floors')
    .filter((each) => each['buildingId'] === buildingId)
    .sort(byLevel)
  const rooms = useRecords('rooms').filter((each) => each['buildingId'] === buildingId)
  const loose = useRecords('assets')
    .filter(
      (each) =>
        each['buildingId'] === buildingId &&
        maybeText(each, 'roomId') === null &&
        maybeText(each, 'parentAssetId') === null,
    )
    .sort(byNumber)
  const catalogue = useCatalogue()
  const records = useRight('asset.record')

  if (!building || buildingId === undefined) {
    return <NotOnDevice what="Dieses Gebäude" back={backToStart} />
  }

  const sub = buildingLine(building)

  return (
    <>
      <SiteHeader
        title={text(building, 'name')}
        {...(sub === '' ? {} : { sub })}
        back={
          property
            ? { to: sitePlaces.property(String(property['id'])), label: 'Zurück zur Liegenschaft' }
            : backToStart
        }
      />
      <SiteScreen>
        {property ? <SiteCrumbs items={placePath(placeAbove({ property }), sitePlaces)} /> : null}
        <Panel title="Geschosse">
          {floors.length === 0 ? (
            <SiteText muted>Noch kein Geschoss. Geschosse legt das Büro an.</SiteText>
          ) : (
            <SiteRows label="Geschosse">
              {floors.map((floor) => (
                <SiteRow
                  key={String(floor['id'])}
                  to={sitePlaces.floor(String(floor['id']))}
                  title={text(floor, 'name')}
                  meta={countWords(
                    rooms.filter((room) => room['floorId'] === floor['id']).length,
                    'Raum',
                    'Räume',
                    'Noch kein Raum',
                  )}
                />
              ))}
            </SiteRows>
          )}
        </Panel>
        {loose.length === 0 ? null : (
          <Panel title="Anlagen ohne Raum">
            <SiteRows label="Anlagen ohne Raum">
              {loose.map((asset) => (
                <SiteRow
                  key={String(asset['id'])}
                  to={sitePlaces.asset(String(asset['id']))}
                  title={assetTitle(asset)}
                  meta={kindWords(catalogue, maybeText(asset, 'kind'))}
                />
              ))}
            </SiteRows>
          </Panel>
        )}
      </SiteScreen>
      {records ? (
        <SiteActionBar>
          <GoButton to={stockTaking.assetInBuilding(buildingId)} icon={Plus} tone="primary">
            Anlage aufnehmen
          </GoButton>
        </SiteActionBar>
      ) : null}
    </>
  )
}

/** A floor on site: its rooms, and "Raum aufnehmen". */
export function SiteFloorScreen() {
  const { floorId } = useParams({ strict: false }) as { floorId?: string }
  const floor = useRecord('floors', floorId)
  const building = useRecord('buildings', maybeText(floor, 'buildingId') ?? undefined)
  const property = useRecord('properties', maybeText(floor, 'propertyId') ?? undefined)
  const rooms = useRecords('rooms')
    .filter((each) => each['floorId'] === floorId)
    .sort(byNumber)
  const assets = useRecords('assets')
  const records = useRight('room.record')

  if (!floor || floorId === undefined) {
    return <NotOnDevice what="Dieses Geschoss" back={backToStart} />
  }

  return (
    <>
      <SiteHeader
        title={text(floor, 'name')}
        {...(building ? { sub: text(building, 'name') } : {})}
        back={
          building
            ? { to: sitePlaces.building(String(building['id'])), label: 'Zurück zum Gebäude' }
            : backToStart
        }
      />
      <SiteScreen>
        {property ? (
          <SiteCrumbs items={placePath(placeAbove({ property, building }), sitePlaces)} />
        ) : null}
        <Panel title="Räume">
          {rooms.length === 0 ? (
            <SiteText muted>Noch kein Raum auf diesem Geschoss.</SiteText>
          ) : (
            <SiteRows label="Räume">
              {rooms.map((room) => {
                const standing = assets.filter((asset) => asset['roomId'] === room['id']).length

                return (
                  <SiteRow
                    key={String(room['id'])}
                    to={sitePlaces.room(String(room['id']))}
                    title={titleOfRoom(room)}
                    meta={[
                      maybeText(room, 'use'),
                      standing === 0 ? null : countWords(standing, 'Anlage', 'Anlagen', ''),
                    ]
                      .filter((part) => part !== null && part !== '')
                      .join(' · ')}
                  />
                )
              })}
            </SiteRows>
          )}
        </Panel>
      </SiteScreen>
      {records ? (
        <SiteActionBar>
          <GoButton to={stockTaking.roomOnFloor(floorId)} icon={Plus} tone="primary">
            Raum aufnehmen
          </GoButton>
        </SiteActionBar>
      ) : null}
    </>
  )
}

/**
 * A room on site (board "Raum mit dem Pfad darüber"): the assets that stand
 * there, the ones that supply it without standing there, the open defects of
 * the room and of what stands in it, its documents, and "Anlage aufnehmen".
 * "Mangel melden" arrives with the defects (#116).
 */
export function SiteRoomScreen() {
  const { roomId } = useParams({ strict: false }) as { roomId?: string }
  const room = useRecord('rooms', roomId)
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)
  const building = useRecord('buildings', maybeText(room, 'buildingId') ?? undefined)
  const property = useRecord('properties', maybeText(room, 'propertyId') ?? undefined)
  const assets = useRecords('assets')
  const supplies = useRecords('asset_supplies')
  const defects = useRecords('defects')
  const catalogue = useCatalogue()
  const records = useRight('asset.record')

  if (!room || roomId === undefined) {
    return <NotOnDevice what="Diesen Raum" back={backToStart} />
  }

  const byId = new Map(assets.map((asset) => [String(asset['id']), asset]))
  const here = assets.filter((asset) => asset['roomId'] === roomId).sort(byNumber)
  const standing = new Set(here.map((asset) => String(asset['id'])))
  // An asset supplies this room by an entry for the room or for its whole
  // building; one that stands here is not named a second time.
  const suppliers = [
    ...new Map(
      supplies
        .filter(
          (supply) =>
            supply['roomId'] === roomId ||
            (maybeText(supply, 'roomId') === null && supply['buildingId'] === room['buildingId']),
        )
        .filter((supply) => !standing.has(String(supply['assetId'])))
        .map((supply) => [String(supply['assetId']), supply['roomId'] === roomId] as const),
    ),
  ]
    .map(([id, thisRoom]) => ({ asset: byId.get(id), thisRoom }))
    .filter((entry): entry is { asset: RecordState; thisRoom: boolean } => Boolean(entry.asset))
  const open = defects.filter(
    (defect) =>
      isOpenDefect(defect) &&
      (defect['roomId'] === roomId || standing.has(String(defect['assetId']))),
  )
  const use = maybeText(room, 'use')
  const propertyId = maybeText(room, 'propertyId')

  return (
    <>
      <SiteHeader
        title={titleOfRoom(room)}
        {...(use ? { sub: `Nutzung: ${use}` } : {})}
        back={
          floor
            ? { to: sitePlaces.floor(String(floor['id'])), label: 'Zurück zum Geschoss' }
            : backToStart
        }
      />
      <SiteScreen>
        {property ? (
          <SiteCrumbs items={placePath(placeAbove({ property, building, floor }), sitePlaces)} />
        ) : null}
        <Panel title="Steht hier">
          {here.length === 0 ? (
            <SiteText muted>In diesem Raum steht noch keine Anlage.</SiteText>
          ) : (
            <SiteRows label="Steht hier">
              {here.map((asset) => {
                const parent = byId.get(String(asset['parentAssetId']))

                return (
                  <SiteRow
                    key={String(asset['id'])}
                    to={sitePlaces.asset(String(asset['id']))}
                    title={assetTitle(asset)}
                    meta={
                      parent
                        ? `Komponente von ${assetTitle(parent)}`
                        : kindWords(catalogue, maybeText(asset, 'kind'))
                    }
                  />
                )
              })}
            </SiteRows>
          )}
        </Panel>
        {suppliers.length === 0 ? null : (
          <Panel title="Versorgt von">
            <SiteRows label="Versorgt von">
              {suppliers.map(({ asset, thisRoom }) => (
                <SiteRow
                  key={String(asset['id'])}
                  to={sitePlaces.asset(String(asset['id']))}
                  title={assetTitle(asset)}
                  meta={thisRoom ? 'versorgt diesen Raum' : 'versorgt das Gebäude'}
                />
              ))}
            </SiteRows>
          </Panel>
        )}
        <OpenDefects
          defects={open}
          empty="Kein offener Mangel in diesem Raum."
          named={(defect) => {
            const asset = byId.get(String(defect['assetId']))

            return asset ? assetTitle(asset) : null
          }}
        />
        {propertyId === null ? null : (
          <SiteDocuments
            place={{ propertyId, roomId }}
            empty="Noch kein Dokument an diesem Raum."
          />
        )}
      </SiteScreen>
      {records ? (
        <SiteActionBar>
          <GoButton to={stockTaking.assetInRoom(roomId)} icon={Plus} tone="primary">
            Anlage aufnehmen
          </GoButton>
        </SiteActionBar>
      ) : null}
    </>
  )
}
