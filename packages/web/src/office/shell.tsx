import { OfficeFrame } from '@opengewerk/platform-web/office'

import { useKeepCatalogue } from '../sync/catalogue.js'
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
 * of its server (`useKeepCatalogue`): every screen under it may ask one.
 *
 * The search in its header is the foundation's field with the sources of this
 * application (#125, ADR 0010): what it finds, how its kinds are called and
 * where a hit opens (`useOfficeSearch`).
 */
export function OfficeShell() {
  const { groups, foot } = useNavigation()
  const search = useOfficeSearch()

  useKeepCatalogue()

  return <OfficeFrame navigation={groups} foot={foot} search={search} />
}
