import { Empty, PageHead, Screen } from '@opengewerk/platform-web/office'

import { officePlaces } from './place-addresses.js'

/**
 * What the pages of a building, a floor and a room share in the office (4.1
 * of the concept): what stands in their place when the record is not there
 * for this device.
 */

/**
 * Why a place is not there, as a whole sentence each: it was removed, it lies
 * in an area the person does not see, or the device has not been told of it
 * yet. Which of the three, a device cannot know.
 */
const notThere = {
  building:
    'Dieses Gebäude gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
  floor:
    'Dieses Geschoss gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
  room: 'Diesen Raum gibt es nicht mehr, er liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt ihn noch nicht.',
} as const

export function PlaceNotFound({ place }: { readonly place: keyof typeof notThere }) {
  return (
    <Screen>
      <PageHead title="Nicht gefunden" crumbs={[officePlaces.list]} />
      <Empty>{notThere[place]}</Empty>
    </Screen>
  )
}

/** "1 Raum", "14 Räume". */
export function countedRooms(rooms: number): string {
  return `${rooms.toLocaleString('de-DE')} ${rooms === 1 ? 'Raum' : 'Räume'}`
}

/** "1 Anlage", "11 Anlagen". */
export function countedAssets(assets: number): string {
  return `${assets.toLocaleString('de-DE')} ${assets === 1 ? 'Anlage' : 'Anlagen'}`
}
