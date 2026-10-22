import { OfficeFrame } from '@opengewerk/platform-web/office'
import { usePushRefresh, useRight } from '@opengewerk/platform-web/session'
import { useEffect } from 'react'

import { useKeepCatalogue } from '../sync/catalogue.js'
import { useKeepForTheRoad } from '../sync/travel.js'
import { BackupBar } from './screens/backup.js'
import { useOfficeHelp } from './help.js'
import { useNavigation } from './navigation.js'
import { useOfficeSearch } from './search-source.js'

/**
 * What every office screen sits in. The frame is the foundation's (ADR 0010
 * in the repository opengewerk): the header in slate, the strips, the
 * navigation beside the screen and behind "Menü" on a phone, with the two
 * places at its foot that are visited rather than worked in, the exchange
 * with the server and the settings.
 *
 * The places of this application are those of its board, each from the
 * moment its screen is built and for whoever holds its right
 * (`useNavigation`). Until the first of them arrives, the navigation is the
 * foot alone.
 *
 * The frame is also where the device sees to it that it holds the catalogue
 * of its server (`useKeepCatalogue`): every screen under it may ask one. And
 * that it holds the files of the places marked for the road as the frame on
 * site does (`useKeepForTheRoad`, #536): a device that is only opened in the
 * office afterwards lets go of the files of an area or a right it lost.
 *
 * The search in its header is the foundation's field with the sources of this
 * application (#125, ADR 0010): what it finds, how its kinds are called and
 * where a hit opens (`useOfficeSearch`).
 *
 * A device with push on writes its row again at every start, bound to the
 * session of now (#126, `usePushRefresh`).
 *
 * Over every screen stands the strip for a backup that is behind, for
 * whoever may see the settings (#127, `BackupBar`).
 *
 * The question mark in its header opens the text of the page that stands
 * (#131): the button and the drawer are the foundation's, the texts this
 * application's (`useOfficeHelp`).
 */
export function OfficeShell() {
  useReporterOnSite()

  const { groups, foot } = useNavigation()
  const search = useOfficeSearch()
  const help = useOfficeHelp()

  useKeepCatalogue()
  useKeepForTheRoad()
  usePushRefresh('office')

  return (
    <OfficeFrame
      navigation={groups}
      foot={foot}
      search={search}
      help={help}
      strips={<BackupBar />}
    />
  )
}

/**
 * A Melder works on site and nowhere else (#331, section 4.7 of the concept):
 * the office has nothing for somebody who reports and sees no place, so it
 * goes on to the own reports under "Vor Ort".
 */
function useReporterOnSite() {
  const reports = useRight('fault.report')
  const seesPlaces = useRight('location.read')

  useEffect(() => {
    if (reports && !seesPlaces) {
      window.location.replace('/m/')
    }
  }, [reports, seesPlaces])
}
