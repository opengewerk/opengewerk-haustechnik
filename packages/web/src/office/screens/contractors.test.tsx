import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'

/**
 * "Fremdfirmen" (#328, 4.11 of the concept, the boards of that name): the
 * firms of the operator with their services and open duties, the names that
 * stand as text at duties to take over, and the page of a firm. Every role
 * looks; the Leitung and the Technische Leitung keep the firms.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const synced = {
  version: 1,
  updatedBy: null,
  deviceId: null,
  deletedAt: null,
  changeSequence: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
}

const fire = {
  ...synced,
  id: 'c-fire',
  name: 'Brandschutz Beispiel GmbH',
  street: 'Industriestraße 12',
  postalCode: '68169',
  city: 'Mannheim',
  phone: '0621 445566',
  email: 'service@brandschutz-beispiel.example',
  services: ['450', '470'],
  note: 'Rufbereitschaft am Wochenende.',
}

const lift = {
  ...synced,
  id: 'c-lift',
  name: 'Aufzugsdienst Rhein-Neckar GmbH',
  street: null,
  postalCode: '68219',
  city: 'Mannheim',
  phone: null,
  email: null,
  services: ['460'],
  note: null,
}

const answers = {
  '/contractors': [
    { ...lift, openDuties: 3 },
    { ...fire, openDuties: 0 },
  ],
  '/contractors/names': [
    { name: 'Kälte Klima Süd', duties: 2, contractorId: null },
    { name: 'Prüfdienst Weber', duties: 1, contractorId: null },
  ],
  '/contractors/c-fire': {
    contractor: fire,
    openDuties: 0,
    openActivities: 0,
    evidence: [
      {
        id: 'e-118',
        number: 'NW-2026-00118',
        dutyTitle: 'Prüfung der Brandmeldeanlage',
        performedOn: '2026-09-15',
        result: 'without_defects',
        examinerOrganisation: 'Brandschutz Beispiel GmbH',
      },
    ],
  },
  '/contractors/c-lift': { contractor: lift, openDuties: 3, openActivities: 1, evidence: [] },
  // A briefing at an order of the firm (#330).
  '/contractors/c-fire/visits': {
    briefings: [
      {
        id: 'br-1',
        activityId: 'ac-fire',
        orderNumber: 'AU-2026-0034',
        orderTitle: 'Löschwasserleitung im Keller anschließen',
        contractorId: 'c-fire',
        contractorName: 'Brandschutz Beispiel GmbH',
        personName: 'Marco Petri',
        subject: 'Fluchtwege',
        path: 'M10,10L200,300',
        signedByName: 'Tobias Wendt',
        signedAt: '2026-10-07T05:40:00.000Z',
      },
    ],
    permits: [],
  },
  // The activities still to be done that the firm carries out (#328).
  '/activities?state=pending&contractor=c-fire&offset=0&limit=5': {
    total: 1,
    more: false,
    activities: [
      {
        id: 'ac-fire',
        kind: 'inspection',
        title: 'Prüfung der Feuerlöscher',
        status: 'open',
        dueOn: '2026-10-07',
        propertyId: 'p-1',
        areaId: 'a-nord',
        buildingId: null,
        roomId: null,
        assetId: null,
        responsible: null,
        performer: 'contractor',
        performerPerson: null,
        contractorNote: null,
        contractorId: 'c-fire',
      },
    ],
  },
}

function mounted(role: RoleKey, at = '/fremdfirmen') {
  const written = signedInOffice(role, [nord], answers, (write: Written) => ({
    status: write.method === 'POST' ? 201 : 200,
    body: write.path === '/contractors/takeover' ? { firms: 2, duties: 3 } : { id: 'made' },
  }))

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const listTable = 'Fremdfirmen mit Ort, Leistungen und offenen Pflichten'

describe('the list of the contractors', () => {
  it('shows every firm with its place, its services and its open duties', async () => {
    const { done } = mounted('technician')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(rowsOf(listTable)).toEqual([
      ['Aufzugsdienst Rhein-Neckar GmbH68219 Mannheim', 'KG 460', '3'],
      ['Brandschutz Beispiel GmbH68169 Mannheim', 'KG 450, KG 470', '0'],
    ])

    // Narrowed to the firms of one cost group.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Leistung' }), '470')
    expect(rowsOf(listTable).map((row) => row[1])).toEqual(['KG 450, KG 470'])
  })

  it('offers whoever only looks neither a new firm nor the names to take over', async () => {
    const { done } = mounted('site_management')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(screen.queryByRole('button', { name: 'Fremdfirma anlegen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Namen übernehmen' })).toBeNull()
  })

  it('makes a firm with its services once each, in the order of the groups', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Fremdfirma anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Fremdfirma anlegen' }))

    await userEvent.type(dialog.getByLabelText(/^Name/), ' Elektro Kraus & Sohn ')
    await userEvent.type(dialog.getByLabelText('Ort'), 'Edingen-Neckarhausen')
    await userEvent.click(dialog.getByRole('checkbox', { name: /^KG 450/ }))
    await userEvent.click(dialog.getByRole('checkbox', { name: /^KG 440/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contractors',
          body: {
            name: 'Elektro Kraus & Sohn',
            street: null,
            postalCode: null,
            city: 'Edingen-Neckarhausen',
            phone: null,
            email: null,
            services: ['440', '450'],
            note: null,
          },
        },
      ])
    })
  })

  // The people to talk to come with the firm (#383): an empty one is none, a filled one needs its family name.
  it('makes a firm with the people to talk to who say something, and none without a family name', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Fremdfirma anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Fremdfirma anlegen' }))

    await userEvent.type(dialog.getByLabelText(/^Name/), 'Kältetechnik Süd')
    await userEvent.click(dialog.getByRole('button', { name: /^Ansprechpartner/ }))

    const first = within(dialog.getByRole('group', { name: 'Ansprechpartner 1' }))

    await userEvent.type(first.getByLabelText('Vorname'), 'Klaus')
    await userEvent.click(dialog.getByRole('button', { name: 'Weiteren hinzufügen' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Weiteren hinzufügen' }))

    const second = within(dialog.getByRole('group', { name: 'Ansprechpartner 2' }))

    await userEvent.type(second.getByLabelText(/^Nachname/), 'Lang')
    await userEvent.type(second.getByLabelText('Telefon'), '0621 123')
    await userEvent.type(second.getByLabelText('Mobil'), '0170 456')
    await userEvent.click(dialog.getByRole('button', { name: 'Anlegen' }))

    // The first says something and has no family name: nothing goes out.
    expect(await first.findByText('Der Nachname fehlt.')).toBeDefined()
    expect(written).toEqual([])

    await userEvent.type(first.getByLabelText(/^Nachname/), 'Berger')
    await userEvent.click(dialog.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contractors',
          body: {
            name: 'Kältetechnik Süd',
            street: null,
            postalCode: null,
            city: null,
            phone: null,
            email: null,
            services: [],
            note: null,
            contacts: [
              {
                givenName: 'Klaus',
                familyName: 'Berger',
                role: null,
                phone: null,
                mobile: null,
                email: null,
              },
              {
                givenName: null,
                familyName: 'Lang',
                role: null,
                phone: '0621 123',
                mobile: '0170 456',
                email: null,
              },
            ],
          },
        },
      ])
    })
  })

  it('takes the names at duties over, each as a new firm or one of the list', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    expect(
      await screen.findByText(
        'An 3 Pflichten steht eine Fremdfirma noch als Text: „Kälte Klima Süd“ (2 Pflichten) und „Prüfdienst Weber“ (1 Pflicht). Übernehmen Sie sie in die Liste, dann wählen die Pflichten sie aus.',
      ),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Namen übernehmen' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: 'Namen als Fremdfirmen übernehmen' }),
    )

    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: 'Wird zu, für Prüfdienst Weber' }),
      'c-fire',
    )
    await userEvent.click(dialog.getByRole('button', { name: '2 übernehmen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contractors/takeover',
          body: {
            items: [
              { name: 'Kälte Klima Süd', contractorId: null },
              { name: 'Prüfdienst Weber', contractorId: 'c-fire' },
            ],
          },
        },
      ])
    })
  })
})

describe('the page of a contractor', () => {
  it('shows its address, its services and the evidence of its reports with the organisation as written', async () => {
    const { done } = mounted('technician', '/fremdfirmen/c-fire')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: 'Brandschutz Beispiel GmbH' })

    expect(screen.getByText('Industriestraße 12')).toBeTruthy()
    expect(screen.getByText('68169 Mannheim')).toBeTruthy()
    expect(screen.getByText('Rufbereitschaft am Wochenende.')).toBeTruthy()
    expect(screen.getByText('Organisation: Brandschutz Beispiel GmbH')).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Prüfung der Feuerlöscher' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'NW-2026-00118 Prüfung der Brandmeldeanlage' }),
    ).toBeTruthy()
    // The briefings and permits at its orders (#330), with the way to the order.
    expect((await screen.findByRole('link', { name: 'AU-2026-0034' })).getAttribute('href')).toBe(
      '/auftraege/ac-fire',
    )
    expect(screen.getByText('Marco Petri')).toBeTruthy()
    // Whoever only looks neither changes nor removes the firm.
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull()
  })

  it('says why a firm that open duties name cannot be removed, and offers no removal', async () => {
    const { written, done } = mounted('technical_management', '/fremdfirmen/c-lift')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: 'Aufzugsdienst Rhein-Neckar GmbH entfernen?' }),
    )

    expect(
      dialog.getByText(
        'Solange eine offene Pflicht oder ein offener Vorgang die Firma nennt, lässt sie sich nicht entfernen. 3 offene Pflichten und 1 offener Vorgang nennen sie; wählen Sie dort eine andere Firma oder die eigenen Leute.',
      ),
    ).toBeTruthy()
    expect(dialog.queryByRole('button', { name: 'Entfernen' })).toBeNull()
    expect(written).toEqual([])
  })

  it('removes a firm nothing open names, after the question', async () => {
    const { written, done } = mounted('technical_management', '/fremdfirmen/c-fire')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))

    const asking = within(
      await screen.findByRole('alertdialog', { name: 'Brandschutz Beispiel GmbH entfernen?' }),
    )

    await userEvent.click(asking.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(written).toEqual([{ method: 'DELETE', path: '/contractors/c-fire' }])
    })
  })
})

describe('the people and documents of a contractor (#328)', () => {
  const firmPlace = { propertyId: null, areaId: null, contractorId: fire.id }
  const caller = {
    ...synced,
    id: 'k-kraemer',
    ...firmPlace,
    givenName: 'Petra',
    familyName: 'Krämer',
    role: 'Disposition',
    phone: '0621 445567',
    email: null,
  }
  const certificate = {
    ...synced,
    id: 'd-certificate',
    ...firmPlace,
    buildingId: null,
    roomId: null,
    assetId: null,
    activityId: null,
    defectId: null,
    areaFromPropertyId: null,
    title: 'Zertifikat Fachbetrieb nach DIN 14675',
    kind: 'test_certificate',
    legacy: false,
  }

  /** The page of the firm, with its people and its certificate on the device. */
  async function page(role: RoleKey) {
    const server = new TestServer()

    server.put('contacts', caller)
    server.put('attachments', certificate)
    // The certificate of another firm, which this page does not show.
    server.put('attachments', {
      ...certificate,
      id: 'd-lift',
      contractorId: lift.id,
      title: 'Zulassung Aufzugsdienst',
    })
    server.put('attachment_versions', {
      id: '00000000-0000-7000-8000-000000000011',
      attachmentId: certificate.id,
      sha256: '11'.padEnd(64, 'a'),
      fileName: 'zertifikat-din-14675.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 420_000,
      previewSha256: null,
      validUntil: '2027-03-31',
      createdBy: 'u-lead',
      createdAt: '2026-10-01T09:00:00.000Z',
    })
    signedInOffice(role, [nord], answers)

    const mounted = await mountOffice('/fremdfirmen/c-fire', server, [
      'contacts',
      'attachments',
      'attachment_versions',
    ])

    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: 'Brandschutz Beispiel GmbH' })

    return { ...mounted, server }
  }

  const documents = () => screen.getByRole('region', { name: 'Dokumente' })

  it('shows them on the page of the firm, and to whoever only looks nothing to add', async () => {
    await page('technician')

    expect(await screen.findByText(/Krämer/)).toBeTruthy()
    expect(
      await within(documents()).findByRole('link', {
        name: 'Zertifikat Fachbetrieb nach DIN 14675',
      }),
    ).toBeTruthy()
    // Its kind and the day it is valid until, as the board draws it.
    expect(within(documents()).getByText('Prüfbescheinigung, gültig bis 31.03.2027')).toBeTruthy()
    expect(within(documents()).queryByText('Zulassung Aufzugsdienst')).toBeNull()
    expect(within(documents()).queryByRole('button', { name: 'Hochladen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).toBeNull()
  })

  it('files a document at the firm and names no place', async () => {
    const { client, server } = await page('technical_management')

    fireEvent.click(within(documents()).getByRole('button', { name: 'Hochladen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Dokument hochladen' }))

    fireEvent.change(dialog.getByLabelText('Datei wählen'), {
      target: {
        files: [
          new File(['%PDF-1.7 Versicherung'], 'Betriebshaftpflicht 2026.pdf', {
            type: 'application/pdf',
          }),
        ],
      },
    })
    await waitFor(() => {
      expect(dialog.getByRole<HTMLInputElement>('textbox', { name: /Bezeichnung/ }).value).toBe(
        'Betriebshaftpflicht 2026',
      )
    })
    expect(dialog.getByText(/^Hängt an:/).textContent).toContain(
      'Fremdfirma Brandschutz Beispiel GmbH',
    )
    fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await client.synchronise()

    expect(
      server
        .operations()
        .filter((operation) => operation.kind === 'create' && operation.entity === 'attachments')
        .map((operation) =>
          Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
        ),
    ).toEqual([{ title: 'Betriebshaftpflicht 2026', contractorId: fire.id }])
  })
})
