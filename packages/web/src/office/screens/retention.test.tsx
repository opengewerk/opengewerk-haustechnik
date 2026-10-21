import type {
  RecordRetentionProposals,
  RetentionProposals,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'
import { recordRetentionWords } from './record-retention.js'
import { retentionWords } from './retention.js'

/**
 * "Einstellungen", "Aufbewahrung" (#340, section 2.6 of the concept): the
 * longer retention of the operator, never shorter, and the evidence whose
 * retention has ended, which whoever leads confirms for deletion, several at
 * once, after a question.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const proposals = (mayConfirm: boolean): RetentionProposals => ({
  proposals: [
    {
      evidenceId: 'e-1' as never,
      number: 'NW-2023-00012',
      performedOn: '2023-03-14' as never,
      dutyTitle: 'Prüfung der elektrischen Anlage (DGUV Vorschrift 3)',
      asset: { number: 'AN-00007', name: 'Elektrische Anlage Halle 1' },
      propertyName: 'Werkhof Nord',
      retention: 'Bis zur nächsten Prüfung, mindestens 2 Jahre',
      endedOn: '2025-03-14' as never,
    },
    {
      evidenceId: 'e-2' as never,
      number: 'NW-2016-00048',
      performedOn: '2016-06-20' as never,
      dutyTitle: 'Gefährdungsanalyse der Trinkwasserinstallation',
      asset: { number: 'AN-00021', name: 'Trinkwasserinstallation Schulhaus' },
      propertyName: 'Schulzentrum Am Lindenhain',
      retention: '10 Jahre',
      endedOn: '2026-06-20' as never,
    },
  ],
  mayConfirm,
  more: false,
})

const recordProposals = (mayConfirm: boolean): RecordRetentionProposals => ({
  activities: [
    {
      activityId: 'a-1' as never,
      kind: 'Prüfung',
      title: 'Sichtprüfung der Sicherheitsbeleuchtung',
      endedOn: '2019-05-28' as never,
      place: 'Schulzentrum Am Lindenhain',
      retentionEndedOn: '2026-01-01' as never,
    },
  ],
  defects: [
    {
      defectId: 'd-1' as never,
      foundOn: '2020-11-02' as never,
      remediedOn: '2021-02-03' as never,
      description: 'Notbeleuchtung im Treppenhaus ohne Funktion',
      place: 'Werkhof Nord, Sicherheitsbeleuchtung Halle 1',
      retentionEndedOn: '2026-02-03' as never,
    },
  ],
  mayConfirm,
  more: false,
})

function mounted(role: RoleKey, mayConfirm: boolean) {
  const written = signedInOffice(
    role,
    [nord],
    {
      '/settings/evidence-retention': { minimumYears: 2 },
      '/settings/evidence-retention/proposals': proposals(mayConfirm),
      '/settings/record-retention': {
        activity: null,
        defect: null,
        task: null,
        reading_person: null,
        booking_person: null,
      },
      '/settings/record-retention/proposals': recordProposals(mayConfirm),
    },
    (write) =>
      write.method === 'POST' ? { status: 201, body: { emptied: 1 } } : { status: 200, body: {} },
  )

  return { written, done: mountOffice('/einstellungen/aufbewahrung', new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the retention of the evidence', () => {
  it('is lengthened by whoever changes the settings, and a number outside the bounds is not sent', async () => {
    const { written, done } = mounted('management', true)
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()

    const field = await screen.findByLabelText(retentionWords.minimum)

    await userEvent.clear(field)
    await userEvent.type(field, '51')
    await userEvent.click(
      screen.getAllByRole('button', { name: retentionWords.save })[0] as HTMLElement,
    )
    expect(sent).toEqual([])

    await userEvent.clear(field)
    await userEvent.type(field, '5')
    await userEvent.click(
      screen.getAllByRole('button', { name: retentionWords.save })[0] as HTMLElement,
    )
    await waitFor(() => {
      expect(sent).toEqual([
        { method: 'PUT', path: '/settings/evidence-retention', body: { minimumYears: 5 } },
      ])
    })

    await screen.findByText(retentionWords.saved)
    // Empty is the rule alone.
    await userEvent.clear(field)
    await userEvent.click(
      screen.getAllByRole('button', { name: retentionWords.save })[0] as HTMLElement,
    )
    await waitFor(() => {
      expect(sent.at(-1)).toEqual({
        method: 'PUT',
        path: '/settings/evidence-retention',
        body: { minimumYears: null },
      })
    })
  })

  it('deletes what whoever leads chose, after the question, and nothing else', async () => {
    const { written, done } = mounted('management', true)
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(
      await screen.findByRole('checkbox', { name: retentionWords.choose('NW-2016-00048') }),
    )
    await userEvent.click(
      screen.getAllByRole('button', { name: retentionWords.remove })[0] as HTMLElement,
    )

    const question = await screen.findByRole('dialog', { name: retentionWords.confirmTitle(1) })

    expect(within(question).getByText(retentionWords.confirmWhich(['NW-2016-00048']))).toBeDefined()
    // Nothing goes before the question is answered.
    expect(sent).toEqual([])
    await userEvent.click(within(question).getByRole('button', { name: retentionWords.confirm }))
    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'POST',
          path: '/settings/evidence-retention/emptyings',
          body: { evidenceIds: ['e-2'] },
        },
      ])
    })
  })

  it('lengthens what hangs on no evidence, and never below the law', async () => {
    const { written, done } = mounted('management', true)
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()

    const kinds = await screen.findByRole('region', { name: recordRetentionWords.kinds })
    const field = within(kinds).getByLabelText(
      recordRetentionWords.yearsOf('Vorgang ohne Nachweis'),
    )

    await userEvent.type(field, '5')
    await userEvent.click(within(kinds).getByRole('button', { name: recordRetentionWords.save }))
    expect(sent).toEqual([])

    await userEvent.clear(field)
    await userEvent.type(field, '10')
    await userEvent.click(within(kinds).getByRole('button', { name: recordRetentionWords.save }))
    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'PUT',
          path: '/settings/record-retention',
          body: {
            activity: 10,
            defect: null,
            task: null,
            reading_person: null,
            booking_person: null,
          },
        },
      ])
    })
  })

  it('empties the activities and the defects whoever leads chose, after the question, and nothing else', async () => {
    const { written, done } = mounted('management', true)
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()

    const activities = await screen.findByRole('region', { name: recordRetentionWords.activities })

    await userEvent.click(
      within(activities).getByRole('checkbox', {
        name: recordRetentionWords.choose('Sichtprüfung der Sicherheitsbeleuchtung'),
      }),
    )
    await userEvent.click(
      within(activities).getByRole('button', { name: recordRetentionWords.remove }),
    )

    const question = await screen.findByRole('dialog', {
      name: recordRetentionWords.confirmTitle('activity', 1),
    })

    expect(sent).toEqual([])
    await userEvent.click(
      within(question).getByRole('button', { name: recordRetentionWords.confirm }),
    )
    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'POST',
          path: '/settings/record-retention/activity-emptyings',
          body: { activityIds: ['a-1'] },
        },
      ])
    })

    const defects = screen.getByRole('region', { name: recordRetentionWords.defects })

    await userEvent.click(
      within(defects).getByRole('checkbox', { name: recordRetentionWords.chooseAll('defect') }),
    )
    await userEvent.click(
      within(defects).getByRole('button', { name: recordRetentionWords.remove }),
    )
    await userEvent.click(
      within(
        await screen.findByRole('dialog', { name: recordRetentionWords.confirmTitle('defect', 1) }),
      ).getByRole('button', { name: recordRetentionWords.confirm }),
    )
    await waitFor(() => {
      expect(sent.at(-1)).toEqual({
        method: 'POST',
        path: '/settings/record-retention/defect-emptyings',
        body: { defectIds: ['d-1'] },
      })
    })
  })

  it('offers nothing to choose to whoever does not lead', async () => {
    const { done } = mounted('management', false)

    await done
    await untilTheRightsAreKnown()
    expect(await screen.findByText('NW-2023-00012')).toBeDefined()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: retentionWords.remove })).toBeNull()
  })
})
