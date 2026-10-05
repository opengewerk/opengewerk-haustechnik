import { OfficeFrame } from '@opengewerk/platform-web/office'

import { useKeepCatalogue } from '../sync/catalogue.js'
import { useNavigation } from './navigation.js'

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
 */
export function OfficeShell() {
  const { groups, foot } = useNavigation()

  useKeepCatalogue()

  return <OfficeFrame navigation={groups} foot={foot} />
}
