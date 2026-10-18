import { usePushRefresh } from '@opengewerk/platform-web/session'
import { SiteFrame, SitePush } from '@opengewerk/platform-web/site'

import { useKeepCatalogue } from '../sync/catalogue.js'
import { useKeepForTheRoad } from '../sync/travel.js'
import { HelpMenuRow } from './help.js'
import { ReportingMenuRow } from './reporting.js'
import { useTabs } from './tabs.js'
import { MyTasksMenuRow } from './tasks.js'
import { TravelMenuRow } from './travel.js'

/**
 * What every screen on site sits in. The frame is the foundation's (ADR 0010
 * in the repository opengewerk): the strips, the header of a screen, the tabs
 * where the thumb is, the conflicts after them and the menu.
 *
 * The tabs of this application are those of its board, each from the moment
 * its screen is built and for whoever holds its right (`useTabs`). Until the
 * first of them arrives, the device on site shows what it holds of the sync,
 * and the menu with the account and the way to the office. A Melder has
 * neither the conflicts nor the office (#392): nothing on its device can come
 * into conflict, and the office would send it back.
 *
 * The frame is also where the device sees to it that it holds the catalogue
 * of its server (`useKeepCatalogue`): on site it is asked without a network.
 * And that it holds the files of the places marked for the road
 * (`useKeepForTheRoad`, #348), after every exchange.
 *
 * The menu carries the tasks of the person, the documents kept for the road
 * and, under them, push on this
 * device with the occasions (#126, the board "Menü"); a device with push on
 * writes its row again at every start (`usePushRefresh`). Its last row is the
 * help, which is read without a network (#131).
 */
export function SiteShell() {
  useKeepCatalogue()
  useKeepForTheRoad()
  usePushRefresh('site')

  const { tabs, reportsOnly } = useTabs()

  return (
    <SiteFrame
      tabs={tabs}
      conflicts={!reportsOnly}
      office={!reportsOnly}
      menu={
        <>
          <MyTasksMenuRow />
          <TravelMenuRow />
          <ReportingMenuRow />
          <SitePush entry="site" />
          <HelpMenuRow />
        </>
      }
    />
  )
}
