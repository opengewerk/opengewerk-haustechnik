import type { AuditChange, AuditPage } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { mountOffice, onA, signedInOffice } from '../test-office.js'

/**
 * The change log of a tenant in the office, read with the catalogue of the
 * device (#245). The screen is the foundation's and has its tests there (ADR
 * 0010 in the repository opengewerk); held here is that this application
 * hands it the words of its catalogue: a duty from the catalogue has no name
 * of its own, and the log says what its kind is called.
 */

const mainTest = 'probe.elevator_main_test'
const interimCheck = 'probe.interim_check'

function confirmed(recordId: string, table: string, kind: string, sequence: number): AuditChange {
  return {
    changeId: `change-${recordId}`,
    changedAt: '2026-10-02T14:20:00Z',
    operation: 'insert',
    table,
    recordId,
    userId: 'u-1',
    deviceId: null,
    reason: null,
    databaseRole: 'opengewerk_app',
    firstSequence: sequence,
    lastSequence: sequence,
    fields: [{ field: 'kind', before: null, after: kind }],
  }
}

const log: AuditPage = {
  changes: [
    confirmed('duty-1', 'duties', mainTest, 2),
    confirmed('dismissal-1', 'duty_dismissals', interimCheck, 1),
  ],
  next: null,
  titles: {
    'duty-1': { table: 'duties', field: 'kind', title: mainTest, kind: null },
    'dismissal-1': { table: 'duty_dismissals', field: 'kind', title: interimCheck, kind: null },
  },
  people: { 'u-1': 'Pia Person' },
  devices: {},
}

const theLog = { '/audit/changes': log, '/audit/people': [] }

/** The log in the office of the Leitung, who alone reads it. */
async function mount(further: Readonly<Record<string, unknown>>) {
  signedInOffice('management', [], { ...theLog, ...further })

  const mounted = await mountOffice('/einstellungen/protokoll', new TestServer(), [])

  await screen.findByRole('heading', { level: 1, name: 'Änderungsprotokoll' })

  return mounted
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the change log in the office', () => {
  it('names a duty from the catalogue and a dismissed proposal by the kind, as the catalogue of the device calls it', async () => {
    await mount(servingCatalogue())

    expect((await screen.findAllByText('Hauptprüfung der Aufzugsanlage')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Zwischenprüfung').length).toBeGreaterThan(0)
    expect(screen.queryByText(mainTest)).toBeNull()
    expect(screen.queryByText(interimCheck)).toBeNull()
  })

  it('leaves the key standing on a device that holds no catalogue', async () => {
    await mount({})

    expect((await screen.findAllByText(mainTest)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(interimCheck).length).toBeGreaterThan(0)
  })
})
