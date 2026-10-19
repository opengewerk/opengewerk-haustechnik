import type { ProcessingActivityView, ProcessingRecordView } from '@opengewerk/haustechnik-domain'
import { processingActivities } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'
import { recordScreenWords } from './processing-record.js'

/**
 * "Einstellungen", "Datenschutz", "Verzeichnis" (#358): who is responsible,
 * the data protection officer, and every activity with the proposal of the
 * application or what the Leitung confirmed or changed.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const activities: readonly ProcessingActivityView[] = processingActivities.map((activity) => ({
  key: activity.key,
  title: activity.title,
  sections: activity.sections,
  subjects: activity.subjects,
  data: activity.data,
  proposedPurpose: activity.purpose,
  proposedLegalBasis: activity.legalBasis,
  purpose: activity.key === 'accounts' ? 'Anmeldung der Beschäftigten' : null,
  legalBasis: activity.key === 'accounts' ? 'Art. 6 Abs. 1 lit. b DSGVO' : null,
  recipients: null,
  deletion: activity.key === 'accounts' ? ['L5', 'L8', 'L3'] : [],
}))

const record: ProcessingRecordView = {
  controller: 'Wohnbau Nord eG\nHafenweg 1',
  officer: null,
  activities,
}

function mounted() {
  const written = signedInOffice(
    'management',
    [nord],
    {
      '/settings/processing-record': record,
      '/settings/privacy-documents': { kinds: [], versions: [] },
    },
    () => ({ status: 200, body: record }),
  )

  return {
    written,
    done: mountOffice('/einstellungen/datenschutz/verzeichnis', new TestServer(), []),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the record of the processing, where the Leitung keeps what it wrote', () => {
  it('shows who is responsible, and each activity confirmed or as a proposal', async () => {
    const { done } = mounted()

    await done
    await untilTheRightsAreKnown()

    const controller = (await screen.findByRole('textbox', {
      name: recordScreenWords.controller,
    })) as HTMLTextAreaElement

    expect(controller.value).toBe('Wohnbau Nord eG\nHafenweg 1')

    const table = screen.getByRole('table', { name: recordScreenWords.caption })

    expect(within(table).getByText('Anmeldung der Beschäftigten')).toBeTruthy()
    expect(within(table).getAllByText(recordScreenWords.confirmed)).toHaveLength(1)
    expect(within(table).getAllByText(recordScreenWords.proposal)).toHaveLength(
      processingActivities.length - 1,
    )
    expect(within(table).getByText(processingActivities[6].purpose)).toBeTruthy()
  })

  it('saves who is responsible and the data protection officer', async () => {
    const { written, done } = mounted()

    await done
    await untilTheRightsAreKnown()

    const officer = await screen.findByRole('textbox', { name: recordScreenWords.officer })

    await userEvent.type(officer, 'Dr. Petra Lindner')
    await userEvent.click(
      screen.getAllByRole('button', { name: recordScreenWords.save })[0] as HTMLElement,
    )

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/settings/processing-record',
          body: { controller: 'Wohnbau Nord eG\nHafenweg 1', officer: 'Dr. Petra Lindner' },
        },
      ])
    })
  })

  it('confirms an activity with what the dialog shows, and takes a change back to the proposal', async () => {
    const { written, done } = mounted()

    await done
    await untilTheRightsAreKnown()

    await userEvent.click(
      await screen.findByRole('button', {
        name: recordScreenWords.editOf('Ansprechpartner und Fremdfirmen'),
      }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'Ansprechpartner und Fremdfirmen' })

    expect(within(dialog).getByText(recordScreenWords.proposalHint)).toBeTruthy()
    // Nothing to take back while the proposal stands.
    expect(
      (within(dialog).getByRole('button', { name: recordScreenWords.restore }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: recordScreenWords.recipients }),
      'Fremdfirmen',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: recordScreenWords.save }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/settings/processing-record/activities/third-parties',
          body: {
            purpose: processingActivities[6].purpose,
            legalBasis: processingActivities[6].legalBasis,
            recipients: 'Fremdfirmen',
          },
        },
      ])
    })

    written.length = 0
    await userEvent.click(
      await screen.findByRole('button', { name: recordScreenWords.editOf('Konten und Anmeldung') }),
    )

    const confirmed = await screen.findByRole('dialog', { name: 'Konten und Anmeldung' })

    await userEvent.click(
      within(confirmed).getByRole('button', { name: recordScreenWords.restore }),
    )

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/settings/processing-record/activities/accounts',
          body: { purpose: null, legalBasis: null, recipients: '' },
        },
      ])
    })
  })

  it('sends nothing while the purpose or the legal basis is empty, and says why', async () => {
    const { written, done } = mounted()

    await done
    await untilTheRightsAreKnown()

    await userEvent.click(
      await screen.findByRole('button', { name: recordScreenWords.editOf('Störmeldungen') }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'Störmeldungen' })

    fireEvent.change(within(dialog).getByRole('textbox', { name: /Rechtsgrundlage/ }), {
      target: { value: '  ' },
    })
    await userEvent.click(within(dialog).getByRole('button', { name: recordScreenWords.save }))

    expect(await within(dialog).findByText(recordScreenWords.bothOrNeither)).toBeTruthy()
    expect(written).toEqual([])
  })
})
