import { ApplicationProvider, useApplication } from '@opengewerk/platform-web'
import { AuditLogScreen } from '@opengewerk/platform-web/office'
import { useMemo } from 'react'

import { useCatalogue } from '../../sync/catalogue.js'
import { auditScreenWordsWith } from '../audit.js'

/**
 * The change log of a tenant, which is the foundation's screen, read with
 * the catalogue of this device (#245).
 *
 * What a key of the catalogue is called is no part of the interface: it
 * comes with the catalogue a device fetches and keeps. The value this
 * application hands the foundation is made before anybody is signed in, so
 * the words of the log that need the catalogue are handed in here, around
 * the one screen that reads them, once the device holds it.
 */
export function ChangeLogScreen() {
  const application = useApplication()
  const catalogue = useCatalogue()
  const withCatalogue = useMemo(
    () => ({ ...application, audit: auditScreenWordsWith(catalogue) }),
    [application, catalogue],
  )

  return (
    <ApplicationProvider application={withCatalogue}>
      <AuditLogScreen />
    </ApplicationProvider>
  )
}
