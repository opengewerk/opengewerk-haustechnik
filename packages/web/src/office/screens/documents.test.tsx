import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'

/**
 * "Dokumente" in the office (#97, 4.10 of the concept): the list of the
 * documents with what each hangs on, the versions of the one that is chosen,
 * and what is done to a document: filing one, laying a version over it,
 * correcting its name and its kind, and taking it out of the records. All of
 * it is read from the device and written through its outbox.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const yard = { ...school, id: 'p-yard', name: 'Werkhof Nord' }
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const gym = { id: 'b-gym', ...place, name: 'Sporthalle', kinds: '["school"]', yearBuilt: null }
const hall = { id: 'b-hall', ...place, propertyId: yard.id, name: 'Halle 1', kinds: '["other"]' }
const ground = { id: 'f-ground', ...place, buildingId: house.id, name: 'Erdgeschoss', level: 0 }
const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
const lift = {
  id: 's-lift',
  ...place,
  buildingId: house.id,
  roomId: null,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00012',
  name: 'Aufzug Schulhaus',
}

const nowhere = { buildingId: null, roomId: null, assetId: null, activityId: null }
const manual = {
  id: 'd-manual',
  ...place,
  ...nowhere,
  assetId: lift.id,
  title: 'Betriebsanleitung BA 630',
  kind: 'operating_manual',
}
const concept = {
  id: 'd-concept',
  ...place,
  ...nowhere,
  title: 'Brandschutzkonzept Schulzentrum',
  kind: 'concept',
}
const plan = {
  id: 'd-plan',
  ...place,
  ...nowhere,
  roomId: boilerRoom.id,
  title: 'Schaltplan Heizraum',
  kind: 'circuit_diagram',
}
const plate = {
  id: 'd-plate',
  ...place,
  ...nowhere,
  assetId: lift.id,
  title: 'Typenschild',
  kind: null,
}
const handover = {
  id: 'd-handover',
  ...place,
  ...nowhere,
  buildingId: house.id,
  title: 'Revisionsunterlagen Heizung',
  kind: 'as_built_documentation',
}

/** A version as a device holds it, with who filed it and the moment it was filed. */
function version(
  id: string,
  attachmentId: string,
  fileName: string,
  sizeBytes: number,
  day: string,
  mediaType = 'application/pdf',
) {
  return {
    id,
    attachmentId,
    sha256: id.replaceAll('-', '').padEnd(64, 'a'),
    fileName,
    mediaType,
    sizeBytes,
    previewSha256: null,
    createdBy: 'u-kraemer',
    createdAt: `${day}T14:37:21.000Z`,
  }
}

/**
 * The id of a version in the form a device mints one, from long ago: the
 * newest version of each document decides the order, the higher its id, the
 * later, and one filed in a test comes after all of these.
 */
const versionId = (order: number) => `00000000-0000-7000-8000-0000000000${String(order)}`

const versions = [
  version(versionId(91), manual.id, 'betriebsanleitung-ba630.pdf', 2_900_000, '2026-03-14'),
  version(versionId(99), manual.id, 'betriebsanleitung-ba630.pdf', 3_400_000, '2026-09-12'),
  version(versionId(80), concept.id, 'brandschutzkonzept-2019.pdf', 12_800_000, '2026-03-14'),
  version(versionId(70), plan.id, 'schaltplan-heizraum.pdf', 820_000, '2026-09-02'),
  version(versionId(60), plate.id, 'typenschild.jpg', 640_000, '2026-08-20', 'image/jpeg'),
  version(versionId(50), handover.id, 'revision-heizung.pdf', 48_200_000, '2026-01-12'),
]

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'activities',
  'attachments',
  'attachment_versions',
] as const

const tableName = 'Dokumente mit Art, woran sie hängen, Fassung und Tag der letzten Änderung'

let server: TestServer

async function mount(role: RoleKey = 'management', at = '/dokumente', lacking: string[] = []) {
  const member = memberIn(role)

  signedInOffice(role, [sued], {
    '/auth/tenants': [
      { ...member, rights: member.rights.filter((right) => !lacking.includes(right)) },
    ],
  })

  const mounted = await mountOffice(at, server, everything)

  await untilTheRightsAreKnown()

  return mounted
}

/** The card beside the list. */
function card(): HTMLElement {
  return screen.getByRole('region', { name: 'Fassungen' })
}

/** What the server was sent: the operation on a kind of record, with the fields it carries. */
function sent() {
  return server.operations().map((operation) => ({
    entity: operation.entity,
    operation: operation.kind,
    ...Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
  }))
}

const scan = () =>
  new File(['%PDF-1.7 Wartungsvertrag'], 'Wartungsvertrag Aufzug.pdf', { type: 'application/pdf' })

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()

  for (const property of [school, yard]) {
    server.put('properties', property)
  }

  for (const building of [house, gym, hall]) {
    server.put('buildings', building)
  }

  server.put('floors', ground)
  server.put('rooms', boilerRoom)
  server.put('assets', lift)

  for (const document of [manual, concept, plan, plate, handover]) {
    server.put('attachments', document)
  }

  for (const each of versions) {
    server.put('attachment_versions', each)
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list of documents', () => {
  it('shows every document with its kind, what it hangs on, its version and the day it changed, the one changed last first', async () => {
    await mount()

    expect(rowsOf(tableName)).toEqual([
      [
        'Betriebsanleitung BA 630betriebsanleitung-ba630.pdf, 3,4 MB',
        'Betriebsanleitung',
        'AN-00012 Aufzug Schulhaus',
        'Fassung 2',
        '12.09.2026',
      ],
      [
        'Brandschutzkonzept Schulzentrumbrandschutzkonzept-2019.pdf, 12,8 MB',
        'Konzept',
        'Liegenschaft Schulzentrum Am Lindenhain',
        'Fassung 1',
        '14.03.2026',
      ],
      [
        'Schaltplan Heizraumschaltplan-heizraum.pdf, 820 kB',
        'Schaltplan',
        'Raum E.14 Heizraum, Schulzentrum Am Lindenhain',
        'Fassung 1',
        '02.09.2026',
      ],
      // A picture without a kind is a photo.
      [
        'Typenschildtypenschild.jpg, 640 kB',
        'Foto',
        'AN-00012 Aufzug Schulhaus',
        'Fassung 1',
        '20.08.2026',
      ],
      [
        'Revisionsunterlagen Heizungrevision-heizung.pdf, 48,2 MB',
        'Revisionsunterlage',
        'Gebäude Schulhaus, Schulzentrum Am Lindenhain',
        'Fassung 1',
        '12.01.2026',
      ],
    ])
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.textContent).toContain(
      '5 Dokumente',
    )
  })

  it('leads from what a document hangs on to the page of that record', async () => {
    await mount()

    const table = within(screen.getByRole('table', { name: tableName }))
    const leadsTo = (name: string) => table.getAllByRole('link', { name })[0]?.getAttribute('href')

    expect(leadsTo('AN-00012 Aufzug Schulhaus')).toBe('/anlagen/s-lift')
    expect(leadsTo('Liegenschaft Schulzentrum Am Lindenhain')).toBe('/liegenschaften/p-school')
    expect(leadsTo('Raum E.14 Heizraum, Schulzentrum Am Lindenhain')).toBe('/raeume/r-boiler')
    expect(leadsTo('Gebäude Schulhaus, Schulzentrum Am Lindenhain')).toBe('/gebaeude/b-house')
    // The name of a document chooses it, at an address of its own.
    expect(leadsTo('Schaltplan Heizraum')).toBe('/dokumente/d-plan')
  })

  it('is narrowed by the kind and by what a document hangs on, and both stand in the address', async () => {
    const { router } = await mount()
    const titles = () => rowsOf(tableName).map((row) => row[1])

    fireEvent.click(screen.getByRole('button', { name: 'Schaltplan' }))
    await waitFor(() => {
      expect(titles()).toEqual(['Schaltplan'])
    })
    expect(router.state.location.search).toEqual({ art: 'circuit_diagram' })
    expect(screen.getByRole('button', { name: 'Schaltplan' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Alle' }))
    await waitFor(() => {
      expect(titles()).toHaveLength(5)
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Hängt an' }), {
      target: { value: 'assetId' },
    })
    await waitFor(() => {
      expect(titles()).toEqual(['Betriebsanleitung', 'Foto'])
    })
    expect(router.state.location.search).toEqual({ an: 'assetId' })

    fireEvent.click(screen.getByRole('button', { name: 'Konzept' }))
    await screen.findByText('Kein Dokument passt zu dem, wonach die Liste eingegrenzt ist.')
    expect(router.state.location.search).toEqual({ art: 'concept', an: 'assetId' })
  })

  it('reads what it is narrowed by from the address, and takes a word it does not know for no filter', async () => {
    await mount('management', '/dokumente?art=concept&an=propertyId')

    expect(rowsOf(tableName).map((row) => row[1])).toEqual(['Konzept'])
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Hängt an' }).value).toBe(
      'propertyId',
    )
  })

  it('says so while nothing is filed', async () => {
    server = new TestServer()
    await mount()

    expect(screen.getAllByText('Noch ist kein Dokument abgelegt.').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.textContent).toContain(
      'Kein Dokument',
    )
  })
})

describe('the versions of the chosen document', () => {
  it('are those of the first of the list until somebody chooses another, the newest first, each with the day it was filed', async () => {
    const { router } = await mount()

    expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe(
      'Betriebsanleitung BA 630',
    )
    expect(rowsOf('Fassungen von Betriebsanleitung BA 630')).toEqual([
      ['2', 'betriebsanleitung-ba630.pdf3,4 MB, 12.09.2026'],
      ['1', 'betriebsanleitung-ba630.pdf2,9 MB, 14.03.2026'],
    ])
    expect(card().textContent).toContain('Betriebsanleitung · AN-00012 Aufzug Schulhaus')

    await router.navigate({ to: '/dokumente/d-plan' })
    await waitFor(() => {
      expect(within(card()).getByRole('heading', { level: 3 }).textContent).toBe(
        'Schaltplan Heizraum',
      )
    })
    expect(rowsOf('Fassungen von Schaltplan Heizraum')).toEqual([
      ['1', 'schaltplan-heizraum.pdf820 kB, 02.09.2026'],
    ])
  })

  /** The second point of the acceptance of #97, in the office. */
  it('are each opened by their own id, an older one like the newest, and never by a hash', async () => {
    const opened: string[] = []

    vi.stubGlobal('open', (address: string) => {
      opened.push(address)

      return null
    })
    await mount()

    fireEvent.click(within(card()).getByRole('button', { name: /^Fassung 1 öffnen/ }))
    fireEvent.click(within(card()).getByRole('button', { name: /^Fassung 2 öffnen/ }))
    fireEvent.click(within(card()).getByRole('button', { name: 'Öffnen' }))

    await waitFor(() => {
      expect(opened).toEqual([
        `/attachments/versions/${versionId(91)}/content`,
        `/attachments/versions/${versionId(99)}/content`,
        `/attachments/versions/${versionId(99)}/content`,
      ])
    })

    for (const each of versions) {
      expect(opened.join(' ')).not.toContain(each.sha256)
    }
  })

  /**
   * Who filed a version travels with it as the id of an account, and no
   * screen but the change log shows it (section 9 of the concept). The day a
   * version was filed stands there, the time of day does not.
   */
  it('name nobody and no time of day: neither who filed a version nor when in the day', async () => {
    await mount()

    const page = document.body.textContent

    expect(page).toContain('12.09.2026')
    expect(page).not.toContain('u-kraemer')
    expect(page).not.toMatch(/\d{1,2}:\d{2}/)
    // The versions have a number and a file with its day, and no column for a person.
    expect(
      within(screen.getByRole('table', { name: 'Fassungen von Betriebsanleitung BA 630' }))
        .getAllByRole('columnheader')
        .map((column) => column.textContent),
    ).toEqual(['Fassung', 'Datei'])
  })

  it('say so of a document that is not there for this person', async () => {
    await mount('management', '/dokumente/d-gone')

    expect(within(card()).getByText(/Dieses Dokument gibt es nicht/)).toBeTruthy()
    // The list stands all the same.
    expect(rowsOf(tableName)).toHaveLength(5)
  })

  it('stand above the list on a phone, and only for a document somebody chose', async () => {
    onA('phone')

    const { router } = await mount()
    const column = () => card().parentElement?.className.split(' ') ?? []

    expect(column()).toContain('max-lg:hidden')

    await router.navigate({ to: '/dokumente/d-plan' })
    await waitFor(() => {
      expect(column()).not.toContain('max-lg:hidden')
    })
    expect(column()).toContain('max-lg:order-first')

    // And the way back, which a phone shows in place of a path, leads to the list.
    const back = screen
      .getAllByRole('link')
      .find((link) => link.className.split(' ').includes('sm:hidden'))

    expect(`${back?.textContent ?? ''} > ${back?.getAttribute('href') ?? ''}`).toBe(
      'Dokumente > /dokumente',
    )
  })
})

describe('what somebody is offered', () => {
  const offered = () =>
    ['Hochladen', 'Neue Fassung hochladen', 'Öffnen', 'Bearbeiten', 'Entfernen'].filter(
      (name) => screen.queryByRole('button', { name }) !== null,
    )

  it('is everything but taking a document out for the Haustechnik', async () => {
    await mount('technician')

    expect(offered()).toEqual(['Hochladen', 'Neue Fassung hochladen', 'Öffnen', 'Bearbeiten'])
  })

  it.each(['site_management', 'technical_management', 'management'] as const)(
    'is taking a document out as well for %s',
    async (role) => {
      await mount(role)

      expect(offered()).toEqual([
        'Hochladen',
        'Neue Fassung hochladen',
        'Öffnen',
        'Bearbeiten',
        'Entfernen',
      ])
    },
  )

  it('is opening and nothing else for somebody who may not file documents', async () => {
    await mount('site_management', '/dokumente', ['document.record', 'document.remove'])

    expect(offered()).toEqual(['Öffnen'])
  })

  it('has the change log of a document opened by the Leitung alone', async () => {
    await mount('management')

    expect(within(card()).getByRole('link', { name: 'Änderungen' }).getAttribute('href')).toBe(
      '/einstellungen/protokoll?art=attachments&datensatz=d-manual',
    )
  })

  it('offers the change log to no other role', async () => {
    await mount('technical_management')

    expect(within(card()).queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })

  it('is no place in the navigation for somebody who may not look at documents', async () => {
    await mount('technician', '/liegenschaften', ['document.read'])

    const navigation = within(screen.getByRole('navigation', { name: 'Hauptbereiche' }))

    expect(navigation.queryByRole('link', { name: 'Dokumente' })).toBeNull()
    expect(navigation.getByRole('link', { name: 'Liegenschaften' })).toBeTruthy()
  })
})

describe('filing a document from the list', () => {
  async function opened() {
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }))

    return within(await screen.findByRole('dialog', { name: 'Dokument hochladen' }))
  }

  it('sends the document with its name, its kind and its place, and its version, and shows it first', async () => {
    const { client } = await mount('technician')
    const dialog = await opened()

    fireEvent.change(dialog.getByLabelText('Datei wählen'), { target: { files: [scan()] } })

    // The name begins as the name of the file, and somebody says another.
    const name = dialog.getByRole<HTMLInputElement>('textbox', { name: /Bezeichnung/ })

    await waitFor(() => {
      expect(name.value).toBe('Wartungsvertrag Aufzug')
    })
    fireEvent.change(name, { target: { value: 'Wartungsvertrag 2026' } })
    fireEvent.change(dialog.getByRole('combobox', { name: 'Art' }), {
      target: { value: 'permit' },
    })
    fireEvent.change(dialog.getByRole('combobox', { name: /Liegenschaft/ }), {
      target: { value: school.id },
    })

    // The buildings on offer are those of the property chosen.
    expect(
      within(dialog.getByRole('combobox', { name: 'Gebäude' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Die ganze Liegenschaft', 'Schulhaus', 'Sporthalle'])
    fireEvent.change(dialog.getByRole('combobox', { name: 'Gebäude' }), {
      target: { value: gym.id },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await client.synchronise()

    expect(sent()).toEqual([
      {
        entity: 'attachments',
        operation: 'create',
        title: 'Wartungsvertrag 2026',
        kind: 'permit',
        propertyId: school.id,
        buildingId: gym.id,
      },
      expect.objectContaining({
        entity: 'attachment_versions',
        operation: 'create',
        fileName: 'Wartungsvertrag Aufzug.pdf',
        mediaType: 'application/pdf',
      }),
    ])
    expect(rowsOf(tableName)[0]?.slice(0, 3)).toEqual([
      expect.stringContaining('Wartungsvertrag 2026'),
      'Genehmigung',
      'Gebäude Sporthalle, Schulzentrum Am Lindenhain',
    ])
  })

  it('asks for a file and a property before it sends anything, each in a sentence', async () => {
    const { client } = await mount()
    const dialog = await opened()

    fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))
    expect((await dialog.findByRole('alert')).textContent).toBe('Es ist noch keine Datei gewählt.')

    fireEvent.change(dialog.getByLabelText('Datei wählen'), { target: { files: [scan()] } })
    fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))
    await waitFor(() => {
      expect(dialog.getByRole('alert').textContent).toBe('Die Liegenschaft fehlt.')
    })

    fireEvent.change(dialog.getByRole('combobox', { name: /Liegenschaft/ }), {
      target: { value: school.id },
    })
    fireEvent.change(dialog.getByRole('textbox', { name: /Bezeichnung/ }), {
      target: { value: '   ' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))
    await dialog.findByText('Die Bezeichnung fehlt.')

    await client.synchronise()
    expect(server.operations()).toEqual([])
    expect(server.uploaded.size).toBe(0)
  })

  it('works without a connection, and says of the version that it has not gone up yet', async () => {
    const { client } = await mount()

    // The server is out of reach, as in a cellar: what is filed waits.
    server.offline = true

    const dialog = await opened()

    fireEvent.change(dialog.getByLabelText('Datei wählen'), { target: { files: [scan()] } })
    fireEvent.change(dialog.getByRole('combobox', { name: /Liegenschaft/ }), {
      target: { value: yard.id },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))

    await waitFor(() => {
      expect(rowsOf(tableName)[0]).toEqual([
        'Wartungsvertrag AufzugWartungsvertrag Aufzug.pdf, 24 Byte',
        'Ohne Art',
        'Liegenschaft Werkhof Nord',
        'Fassung 1',
        'noch nicht übertragen',
      ])
    })
    expect(server.operations()).toEqual([])

    server.offline = false
    await client.synchronise()

    expect(server.log.at(-1)).toBe('push attachments,attachment_versions')
  })
})

describe('what is done to the chosen document', () => {
  it('lays a new version over it, which names the document and its own file', async () => {
    const { client } = await mount('technician', '/dokumente/d-plan')

    fireEvent.change(screen.getByLabelText('Neue Fassung wählen'), {
      target: {
        files: [
          new File(['%PDF-1.7 Stand 2026'], 'schaltplan-2026.pdf', { type: 'application/pdf' }),
        ],
      },
    })

    await waitFor(() => {
      expect(rowsOf('Fassungen von Schaltplan Heizraum').map((row) => row[0])).toEqual(['2', '1'])
    })
    await client.synchronise()

    expect(sent()).toEqual([
      expect.objectContaining({
        entity: 'attachment_versions',
        operation: 'create',
        attachmentId: plan.id,
        fileName: 'schaltplan-2026.pdf',
      }),
    ])
    // The version before it is still there, and still opens by its own id.
    expect(rowsOf('Fassungen von Schaltplan Heizraum')[1]).toEqual([
      '1',
      'schaltplan-heizraum.pdf820 kB, 02.09.2026',
    ])
  })

  it('corrects its name and its kind, and sends nothing about where it hangs', async () => {
    const { client } = await mount('technician', '/dokumente/d-plate')

    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Dokument bearbeiten' }))
    const name = dialog.getByRole<HTMLInputElement>('textbox', { name: /Bezeichnung/ })

    expect(name.value).toBe('Typenschild')
    expect(dialog.getByRole<HTMLSelectElement>('combobox', { name: 'Art' }).value).toBe('')

    fireEvent.change(name, { target: { value: ' ' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }))
    await dialog.findByText('Die Bezeichnung fehlt.')

    fireEvent.change(name, { target: { value: 'Typenschild Aufzug' } })
    fireEvent.change(dialog.getByRole('combobox', { name: 'Art' }), {
      target: { value: 'operating_manual' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await client.synchronise()

    expect(server.operations()).toHaveLength(1)
    expect(server.operations()[0]).toMatchObject({
      entity: 'attachments',
      kind: 'update',
      recordId: plate.id,
    })
    expect(
      Object.fromEntries(
        (server.operations()[0]?.patches ?? []).map((patch) => [patch.field, patch.to]),
      ),
    ).toEqual({ title: 'Typenschild Aufzug', kind: 'operating_manual' })
  })

  it('takes it out of the records after a question, and the list goes on without it', async () => {
    const { client, router } = await mount(
      'site_management',
      '/dokumente/d-plan?art=circuit_diagram',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))

    const question = within(
      await screen.findByRole('alertdialog', { name: 'Schaltplan Heizraum entfernen?' }),
    )

    expect(question.getByText(/Seine Fassungen bleiben aufbewahrt/)).toBeTruthy()
    // The way out does nothing.
    fireEvent.click(question.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(server.operations()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dokumente')
    })
    expect(router.state.location.search).toEqual({ art: 'circuit_diagram' })
    await client.synchronise()

    // The document is marked, and no version is touched.
    expect(sent()).toEqual([{ entity: 'attachments', operation: 'delete' }])
    expect(server.operations()[0]?.recordId).toBe(plan.id)
    expect(
      screen.getByText('Kein Dokument passt zu dem, wonach die Liste eingegrenzt ist.'),
    ).toBeTruthy()
  })
})
