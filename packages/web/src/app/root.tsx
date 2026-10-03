import { ApplicationProvider } from '@opengewerk/platform-web'
import type { Entry, InterfaceApplication } from '@opengewerk/platform-web'
import { Boot } from '@opengewerk/platform-web/gate'
import type { ReactNode } from 'react'

/**
 * The top of both entries: this application over everything, and the gate of
 * the foundation in front of its screens.
 *
 * The gate is the foundation's (ADR 0010 in the repository opengewerk) and
 * asks for an account and a tenant before it draws a single screen of this
 * application. What it says on the way, it says in the words of the
 * application it is handed, and so does every screen behind it that the
 * foundation draws. Each entry hands in its own: the office the one with the
 * settings of a tenant, the entry on site the one without.
 */
export function Root({
  entry,
  application,
  children,
}: {
  readonly entry: Entry
  readonly application: InterfaceApplication
  readonly children: ReactNode
}) {
  return (
    <ApplicationProvider application={application}>
      <Boot entry={entry}>{children}</Boot>
    </ApplicationProvider>
  )
}
