import type {
  DutyColleague,
  DutyDetails,
  DutyEvidenceEntry,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * The page of a duty in the office and the dialog that says who answers for
 * it (#101, 4.3 and 2.3 of the concept): the page comes from the server with
 * how the duty stands today, its evidence is read with the right of the
 * evidence, and only whoever keeps the register is offered the dialog.
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
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
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

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets', 'duties'] as const

const at = '/pflichten/d-1'
const evidenceOfTheDuty =
  'Nachweise dieser Pflicht mit Tag, Ergebnis, Herkunft und Bedeutung für die Frist'

/** The main test of an elevator from the catalogue, overdue, at an asset in the boiler room. */
function duty(further: Readonly<Record<string, unknown>> = {}): DutyDetails {
  return {
    id: 'd-1',
    ...place,
    buildingId: null,
    roomId: null,
    assetId: 'a-lift',
    kind: 'probe.elevator_main_test',
    kindVersion: 1,
    label: null,
    basis: null,
    sourceNote: null,
    task: null,
    counting: 'betrsichv',
    intervalDays: null,
    intervalMonths: 12,
    intervalReason: 'Das Gesundheitsamt verlangt die jährliche Prüfung.',
    maximumDays: null,
    maximumMonths: 24,
    responsibleUserId: 'u-roth',
    performer: 'contractor',
    performerNote: 'Prüfdienst Beispiel GmbH',
    confirmedBy: 'u-lead',
    confirmedAt: '2026-09-14T08:00:00.000Z',
    endsOn: null,
    endReason: null,
    title: 'Hauptprüfung der Aufzugsanlage',
    state: 'overdue',
    appointment: { dueOn: '2026-07-01', onTimeUntil: '2026-09-30' },
    lastMetOn: '2025-07-12',
    ended: false,
    removable: false,
    asset: {
      id: 'a-lift',
      number: 'AN-00012',
      name: 'Aufzug Schulhaus',
      kind: 'probe.elevator',
      buildingId: house.id,
      roomId: boilerRoom.id,
    },
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    activity: null,
    ...further,
  } as unknown as DutyDetails
}

/** A duty of the operator's own at the boiler room, due, and nobody answers for it. */
const atRoom = duty({
  roomId: boilerRoom.id,
  assetId: null,
  asset: null,
  kind: null,
  kindVersion: null,
  label: 'Heizraum frei von Brandlasten',
  title: 'Heizraum frei von Brandlasten',
  basis: 'own_decision',
  sourceNote: 'Brandschutzordnung Teil C',
  task: 'visual_check',
  counting: 'from_performance',
  intervalMonths: 3,
  intervalReason: null,
  maximumMonths: null,
  responsibleUserId: null,
  responsible: null,
  performer: 'own_staff',
  performerNote: null,
  state: 'due',
  appointment: { dueOn: '2026-10-28', onTimeUntil: '2026-10-28' },
  lastMetOn: '2026-07-28',
})

function evidence(
  id: string,
  number: string,
  performedOn: string,
  further: Partial<DutyEvidenceEntry> = {},
): DutyEvidenceEntry {
  return {
    id,
    number,
    performedOn,
    result: 'without_defects',
    origin: 'report',
    standing: 'counts',
    ...further,
  } as DutyEvidenceEntry
}

const colleagues: readonly DutyColleague[] = [
  { userId: 'u-roth', name: 'Dennis Roth', active: true },
  { userId: 'u-gone', name: 'Gerd Fort', active: false },
  { userId: 'u-lindner', name: 'Petra Lindner', active: true },
]

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

const answering =
  (body: unknown, status = 200) =>
  (): WriteAnswer => ({ status, body })

async function mount(
  answers: Readonly<Record<string, unknown>>,
  role: RoleKey = 'technician',
  address: string = at,
) {
  written = signedInOffice(role, [sued], { ...servingCatalogue(), ...answers }, (write) =>
    answerToWrite(write),
  )

  return mountOffice(address, server, everything)
}

/** Every question a screen asks the server from here on, in order. */
function watchingReads(): string[] {
  const asked: string[] = []
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') {
      asked.push(path)
    }

    return answer(path, init)
  })

  return asked
}

/** What stands beside the title in the head of the page. */
function head(): string {
  return screen.getByRole('heading', { level: 1 }).parentElement?.parentElement?.textContent ?? ''
}

/** Every fact of the page, by its name. */
function facts(): Readonly<Record<string, string | undefined>> {
  const values = screen.getAllByRole('definition')

  return Object.fromEntries(
    screen
      .getAllByRole('term')
      .map((term, index) => [term.textContent, values[index]?.textContent]),
  )
}

const leadsTo = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

async function opened(
  role: RoleKey,
  details: DutyDetails = duty(),
  further: Readonly<Record<string, unknown>> = {},
) {
  const mounted = await mount(
    { [`/duties/${details.id}`]: details, [`/duties/${details.id}/evidence`]: [], ...further },
    role,
    `/pflichten/${details.id}`,
  )

  await screen.findByRole('heading', { level: 1, name: details.title })

  return mounted
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('floors', ground)
  server.put('rooms', boilerRoom)
  answerToWrite = answering({ message: 'Dieser Test hat keinen Schreibzugriff erwartet.' }, 500)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the page of a duty', () => {
  it('shows a duty from the catalogue: its appointment, where it comes from with the version, its interval with the reason, who answers and performs, and what it hangs on', async () => {
    await opened('technician')
    // The kind and its source come with the catalogue of the device.
    await screen.findByText('§ 16 der Probeverordnung')

    expect(head()).toContain('Überfällig')
    expect(head()).toContain('Pflicht an AN-00012 Aufzug Schulhaus')
    expect(facts()).toEqual({
      'Nächster Termin': '01.07.2026',
      // § 14 Abs. 5 BetrSichV: on time until two months after the due month.
      'Fristgerecht bis': '30.09.2026',
      'Letzter Nachweis': '12.07.2025',
      Gezählt: 'Nach § 14 Abs. 5 BetrSichV',
      Vorgang: 'keiner offen',
      Pflichtart: 'Hauptprüfung der Aufzugsanlage',
      Paket: 'Probepaket, Fassung 1 der Pflichtart',
      Fundstelle: '§ 16 der Probeverordnung',
      Tätigkeit: 'Prüfung',
      Bestätigt: 'am 14.09.2026',
      Frist: '12 Monate',
      'Art der Frist': 'Höchstfrist',
      Höchstfrist: '24 Monate, am Tag der Bestätigung',
      Begründung: 'Das Gesundheitsamt verlangt die jährliche Prüfung.',
      Verantwortlich: 'Dennis Roth',
      'Ausgeführt von': 'Fremdfirma: Prüfdienst Beispiel GmbH',
      Anlage: 'Aufzug Schulhaus, AN-00012',
      Liegenschaft: 'Schulzentrum Am Lindenhain',
      Gebäude: 'Schulhaus',
      Raum: 'E.14 Heizraum',
    })
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual(['Pflichtenverzeichnis > /pflichten'])
    // From the page on to the kind in the catalogue, and to what the duty hangs on.
    expect(leadsTo('Hauptprüfung der Aufzugsanlage')).toBe(
      '/katalog/probe/pflichtarten/elevator_main_test',
    )
    expect(leadsTo('Aufzug Schulhaus')).toBe('/anlagen/a-lift')
    expect(leadsTo('Schulzentrum Am Lindenhain')).toBe('/liegenschaften/p-school')
    expect(leadsTo('Schulhaus')).toBe('/gebaeude/b-house')
    expect(leadsTo('E.14 Heizraum')).toBe('/raeume/r-boiler')
  })

  it('shows a duty of the operator own at a room: its basis, its source and its task, and that nobody answers for it', async () => {
    await opened('technician', atRoom)

    expect(head()).toContain('Fällig')
    expect(head()).toContain('Pflicht am Raum E.14 Heizraum')
    expect(facts()).toEqual({
      'Nächster Termin': '28.10.2026',
      'Letzter Nachweis': '28.07.2026',
      Gezählt: 'Ab dem Tag der Durchführung',
      Vorgang: 'keiner offen',
      Grundlage: 'Eigene Festlegung',
      Quelle: 'Brandschutzordnung Teil C',
      Tätigkeit: 'Sichtkontrolle',
      Bestätigt: 'am 14.09.2026',
      Frist: '3 Monate',
      'Art der Frist': 'Eigene Pflicht',
      Verantwortlich: 'Niemand benannt',
      'Ausgeführt von': 'Eigene Leute',
      Liegenschaft: 'Schulzentrum Am Lindenhain',
      Gebäude: 'Schulhaus',
      Raum: 'E.14 Heizraum',
    })
  })

  it('names no task for a duty of the operator own that was entered before it had to name one', async () => {
    await opened('technician', { ...atRoom, task: null })

    expect(facts()).toMatchObject({ Quelle: 'Brandschutzordnung Teil C' })
    expect(facts()['Tätigkeit']).toBeUndefined()
  })

  it('names no appointment for a duty never recorded, for one that rests and for one that has ended, and says why', async () => {
    await opened(
      'technician',
      duty({ state: 'never_recorded', appointment: null, lastMetOn: null }),
    )

    expect(facts()).toMatchObject({
      'Nächster Termin': 'keiner, es gibt noch keinen Nachweis',
      'Letzter Nachweis': 'noch keiner',
    })
    expect(head()).toContain('Nie erfasst')
  })

  it('says of a duty that rests that it does, whatever its last appointment was', async () => {
    await opened('technician', duty({ state: 'dormant' }))

    expect(facts()).toMatchObject({ 'Nächster Termin': 'keiner, solange die Pflicht ruht' })
    expect(facts()['Fristgerecht bis']).toBeUndefined()
    expect(
      screen.getByText(
        'Die Anlage ist nicht in Betrieb. Die Pflicht ruht, bis sie wieder in Betrieb geht, und verfällt nicht.',
      ),
    ).toBeTruthy()
  })

  it('says of a duty that has ended since when and why, and offers nothing to change', async () => {
    await opened(
      'management',
      duty({ ended: true, endsOn: '2026-09-05', endReason: 'Der Aufzug wurde zurückgebaut.' }),
    )

    expect(head()).toContain('Beendet seit 05.09.2026')
    expect(head()).not.toContain('Überfällig')
    expect(facts()).toMatchObject({
      'Nächster Termin': 'keiner, die Pflicht ist beendet',
      Beendet: 'seit 05.09.2026, Der Aufzug wurde zurückgebaut.',
    })
    expect(screen.queryByRole('button', { name: /Verantwortliche Person/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Beenden' })).toBeNull()
  })

  it('lists its evidence, the newest first, each with its result, where it comes from and what it means for the appointment', async () => {
    await mount({
      '/duties/d-1': duty(),
      '/duties/d-1/evidence': [
        evidence('e-4', 'NW-2026-00090', '2026-09-20', {
          result: 'failed',
          standing: 'does_not_meet',
        }),
        evidence('e-3', 'NW-2025-00212', '2025-07-12', { origin: 'legacy' }),
        evidence('e-2', 'NW-2025-00207', '2025-07-10', { standing: 'replaced' }),
        evidence('e-1', 'NW-2024-00088', '2024-07-02', {
          result: 'with_defects',
          standing: 'voided',
        }),
      ],
    })
    await screen.findByRole('table', { name: evidenceOfTheDuty })

    expect(rowsOf(evidenceOfTheDuty)).toEqual([
      [
        'NW-2026-00090',
        '20.09.2026',
        'Nicht bestanden',
        'Bericht einer Fremdfirma oder Prüforganisation',
        'Zählt nicht',
      ],
      [
        'NW-2025-00212',
        '12.07.2025',
        'Ohne Mangel',
        'Altbestand aus einer Vorgängeranwendung',
        'Zählt',
      ],
      [
        'NW-2025-00207',
        '10.07.2025',
        'Ohne Mangel',
        'Bericht einer Fremdfirma oder Prüforganisation',
        'Ersetzt',
      ],
      [
        'NW-2024-00088',
        '02.07.2024',
        'Mit Mängeln',
        'Bericht einer Fremdfirma oder Prüforganisation',
        'Für ungültig erklärt',
      ],
    ])
    expect(
      screen.getByText(
        'Der Termin zählt vom letzten Nachweis, der die Pflicht erfüllt und weder ersetzt noch für ungültig erklärt ist.',
      ),
    ).toBeTruthy()
  })

  it('says so of a duty without evidence', async () => {
    await opened('technician')

    await screen.findByText('Für diese Pflicht ist noch kein Nachweis festgehalten.')
  })

  it('shows the evidence only to somebody who may read evidence, and does not ask the server for anybody else', async () => {
    const technician = memberIn('technician')

    signedInOffice('technician', [sued], {
      ...servingCatalogue(),
      '/duties/d-1': duty(),
      '/duties/d-1/evidence': [evidence('e-1', 'NW-2025-00212', '2025-07-12')],
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'evidence.read') },
      ],
    })

    const reads = watchingReads()

    await mountOffice(at, server, everything)
    await screen.findByRole('heading', { level: 1, name: 'Hauptprüfung der Aufzugsanlage' })
    await screen.findByText('Dennis Roth')

    expect(screen.queryByText('Nachweise')).toBeNull()
    expect(screen.queryByText('NW-2025-00212')).toBeNull()
    expect(reads.filter((path) => path.endsWith('/evidence'))).toEqual([])
  })

  it('says so of a duty that is not there for this person', async () => {
    await mount({}, 'technician', '/pflichten/d-gone')

    await screen.findByRole('heading', { level: 1, name: 'Nicht gefunden' })
    expect(
      screen.getByText(
        'Diese Pflicht gibt es nicht mehr, oder sie liegt in einem Bereich, den dieser Zugang nicht sieht.',
      ),
    ).toBeTruthy()
  })

  it('lights "Pflichtenverzeichnis" in the navigation, and the log is opened from it by the Leitung', async () => {
    await opened('management')

    expect(
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' }))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') !== null)
        .map((link) => link.textContent),
    ).toEqual(['Pflichtenverzeichnis'])
    await screen.findByRole('link', { name: /Änderungen/ })
  })
})

describe('who answers for a duty', () => {
  const offered = () =>
    within(screen.getByRole('combobox', { name: 'Verantwortlich' }))
      .getAllByRole('option')
      .map((option) => option.textContent)

  function choose(value: string): void {
    fireEvent.change(screen.getByRole('combobox', { name: 'Verantwortlich' }), {
      target: { value },
    })
  }

  const save = () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  }

  it.each(['management', 'technical_management'] as const)(
    'is said by whoever keeps the register: "%s" is offered the dialog',
    async (role) => {
      await opened(role, duty(), { '/duties/colleagues': colleagues })

      expect(screen.getByRole('button', { name: 'Verantwortliche Person ändern' })).toBeTruthy()
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'is offered to nobody else: not to "%s", and the people to choose from are not asked for',
    async (role) => {
      signedInOffice(role, [sued], {
        ...servingCatalogue(),
        '/duties/d-1': duty(),
        '/duties/d-1/evidence': [],
        '/duties/colleagues': colleagues,
      })

      const reads = watchingReads()

      await mountOffice(at, server, everything)
      await screen.findByRole('heading', { level: 1, name: 'Hauptprüfung der Aufzugsanlage' })
      await screen.findByText('Dennis Roth')

      expect(screen.queryByRole('button', { name: /Verantwortliche Person/ })).toBeNull()
      expect(reads).not.toContain('/duties/colleagues')
    },
  )

  it('offers nobody and everybody who can still be named, and names the duty it is about', async () => {
    await opened('technical_management', duty(), { '/duties/colleagues': colleagues })

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person ändern' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Verantwortliche Person' }))

    await waitFor(() => {
      // Whoever is shut out of the operator is offered to nobody anew.
      expect(offered()).toEqual(['Niemand', 'Dennis Roth', 'Petra Lindner'])
    })
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Verantwortlich' }).value).toBe(
      'u-roth',
    )
    expect(
      dialog.getByText('Hauptprüfung der Aufzugsanlage, AN-00012 Aufzug Schulhaus'),
    ).toBeTruthy()
    expect(
      dialog.getByText(/Die Pflichtenübertragung mit Unterschrift kommt mit Phase 2/),
    ).toBeTruthy()
  })

  it('keeps somebody shut out in the list where the duty names them, and says that they are', async () => {
    await opened(
      'management',
      duty({ responsibleUserId: 'u-gone', responsible: { userId: 'u-gone', name: 'Gerd Fort' } }),
      { '/duties/colleagues': colleagues },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person ändern' }))
    await screen.findByRole('dialog')

    await waitFor(() => {
      expect(offered()).toEqual(['Niemand', 'Dennis Roth', 'Gerd Fort (gesperrt)', 'Petra Lindner'])
    })
  })

  it('sends the person chosen to the route of the duty, and reads the page again', async () => {
    await opened('technical_management', duty(), { '/duties/colleagues': colleagues })

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person ändern' }))
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(offered()).toContain('Petra Lindner')
    })

    const reads = watchingReads()

    answerToWrite = answering({ id: 'd-1' })
    choose('u-lindner')
    save()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      { method: 'PATCH', path: '/duties/d-1', body: { responsibleUserId: 'u-lindner' } },
    ])
    await waitFor(() => {
      expect(reads).toContain('/duties/d-1')
    })
  })

  it('takes the person from the duty with "Niemand", and names one where there was none', async () => {
    await opened('management', duty(), { '/duties/colleagues': colleagues })

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person ändern' }))
    await screen.findByRole('dialog')

    answerToWrite = answering({ id: 'd-1' })
    choose('')
    save()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      { method: 'PATCH', path: '/duties/d-1', body: { responsibleUserId: null } },
    ])
  })

  it('offers "Benennen" where nobody answers, with nobody chosen', async () => {
    await opened('management', atRoom, { '/duties/colleagues': colleagues })

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person benennen' }))
    await screen.findByRole('dialog')

    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Verantwortlich' }).value).toBe(
      '',
    )
    expect(
      within(screen.getByRole('dialog')).getByText(
        'Heizraum frei von Brandlasten, Raum E.14 Heizraum',
      ),
    ).toBeTruthy()
  })

  it('asks the server for nothing where nothing was changed', async () => {
    await opened('management', duty(), { '/duties/colleagues': colleagues })

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person ändern' }))
    await screen.findByRole('dialog')
    save()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([])
  })

  it('shows what the server refuses with, and keeps the dialog open', async () => {
    await opened('management', duty(), { '/duties/colleagues': colleagues })

    fireEvent.click(screen.getByRole('button', { name: 'Verantwortliche Person ändern' }))
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(offered()).toContain('Petra Lindner')
    })

    answerToWrite = answering(
      { message: 'Verantwortlich ist jemand, der für diesen Betreiber arbeitet.' },
      400,
    )
    choose('u-lindner')
    save()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Verantwortlich ist jemand, der für diesen Betreiber arbeitet.',
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('ending a duty', () => {
  const end = () => {
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Pflicht beenden' }),
    )
  }

  /** The dialog, opened by whoever keeps the register. */
  async function asking(role: RoleKey = 'technical_management', details: DutyDetails = duty()) {
    await opened(role, details)
    fireEvent.click(screen.getByRole('button', { name: 'Beenden' }))

    return within(await screen.findByRole('dialog', { name: 'Pflicht beenden' }))
  }

  it.each(['management', 'technical_management'] as const)(
    'is for whoever keeps the register: "%s" is offered the button',
    async (role) => {
      await opened(role)

      expect(screen.getByRole('button', { name: 'Beenden' })).toBeTruthy()
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'is offered to nobody else: not to "%s"',
    async (role) => {
      await opened(role)
      await screen.findByText('Dennis Roth')

      expect(screen.queryByRole('button', { name: 'Beenden' })).toBeNull()
    },
  )

  it('is not offered for a duty that has its end already, although the day has not come', async () => {
    await opened('management', duty({ endsOn: '2099-12-31' }))

    expect(facts()).toMatchObject({ Endet: 'am 31.12.2099' })
    expect(screen.queryByRole('button', { name: 'Beenden' })).toBeNull()
  })

  it('names the duty it is about, starts with today and says what an end means', async () => {
    const dialog = await asking()

    expect(screen.getByLabelText<HTMLInputElement>('Endet am').value).toBe(today())
    expect(
      dialog.getByText('Hauptprüfung der Aufzugsanlage, AN-00012 Aufzug Schulhaus'),
    ).toBeTruthy()
    expect(dialog.getByText(/Ein Ende wird nicht zurückgenommen/)).toBeTruthy()
  })

  it('sends the day and the reason to the route of the end, and reads the page again', async () => {
    await asking()

    const reads = watchingReads()

    answerToWrite = answering({ id: 'd-1' }, 201)
    fireEvent.change(screen.getByLabelText('Endet am'), { target: { value: '2027-01-31' } })
    fireEvent.change(screen.getByLabelText('Grund'), {
      target: { value: ' Aufzug zurückgebaut ' },
    })
    end()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duties/d-1/end',
        body: { endsOn: '2027-01-31', endReason: 'Aufzug zurückgebaut' },
      },
    ])
    await waitFor(() => {
      expect(reads).toContain('/duties/d-1')
    })
  })

  it('ends it today where no other day is named, and sends no reason where none was given', async () => {
    await asking('management')

    answerToWrite = answering({ id: 'd-1' }, 201)
    end()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      { method: 'POST', path: '/duties/d-1/end', body: { endsOn: today(), endReason: null } },
    ])
  })

  it('is not sent without its day, and says so', async () => {
    const dialog = await asking()

    fireEvent.change(screen.getByLabelText('Endet am'), { target: { value: '' } })
    end()

    expect(await dialog.findByText('Der Tag fehlt, an dem die Pflicht endet.')).toBeTruthy()
    expect(written).toEqual([])
  })

  it('shows what the server refuses with, and keeps the dialog open', async () => {
    await asking()

    answerToWrite = answering({ message: 'Diese Pflicht endet schon am 2026-09-05.' }, 409)
    end()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Diese Pflicht endet schon am 2026-09-05.',
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('changing a duty of the operator own (#178)', () => {
  it.each(['management', 'technical_management'] as const)(
    'is for whoever keeps the register: "%s" is offered "Bearbeiten", which opens its form',
    async (role) => {
      const { router } = await opened(role, atRoom)

      fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/pflichten/d-1/bearbeiten')
      })
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'is offered to nobody else: not to "%s"',
    async (role) => {
      await opened(role, atRoom)
      await untilTheRightsAreKnown()

      expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    },
  )

  it('is not offered for a duty from the catalogue, whose kind says what it is', async () => {
    await opened('management')
    await untilTheRightsAreKnown()

    // Whoever keeps the register is offered what there is to change.
    expect(screen.getByRole('button', { name: 'Beenden' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })

  it('is not offered for a duty that has ended', async () => {
    await opened('management', { ...atRoom, ended: true, endsOn: '2026-09-05' })
    await untilTheRightsAreKnown()

    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })
})

describe('the activity of a duty (#183)', () => {
  // The package by its title, once the catalogue is known; what an activity
  // would be is known no earlier, and so is whether one is offered.
  const fromTheCatalogue = 'Probepaket, Fassung 1 der Pflichtart'
  const underWay = {
    id: 'v-lift',
    kind: 'inspection',
    status: 'started',
    dueOn: '2026-07-01',
    performer: 'contractor',
    contractorNote: 'Prüfdienst Beispiel GmbH',
  }

  it('names the activity under way with the way to it, and offers no second one', async () => {
    const { router } = await opened('site_management', duty({ activity: underWay }))

    await untilTheRightsAreKnown()
    await screen.findByText(fromTheCatalogue)
    expect(facts()['Vorgang']).toBe('Prüfung, begonnen, fällig am 01.07.2026')
    expect(leadsTo('Prüfung, begonnen, fällig am 01.07.2026')).toBe('/pruefungen/v-lift')
    expect(screen.queryByRole('button', { name: 'Prüfung anlegen' })).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Prüfung, begonnen, fällig am 01.07.2026' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pruefungen/v-lift')
    })
  })

  it('makes one for whoever plans: says what it will be, sends the duty, and opens it', async () => {
    answerToWrite = answering({ id: 'v-new' }, 201)

    const { router } = await opened('site_management')

    await untilTheRightsAreKnown()
    expect(facts()['Vorgang']).toBe('keiner offen')

    fireEvent.click(await screen.findByRole('button', { name: 'Prüfung anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Prüfung anlegen' }))

    expect(dialog.getByText('01.07.2026, überfällig')).toBeTruthy()
    expect(dialog.getByText('Fremde Durchführung, Prüfdienst Beispiel GmbH')).toBeTruthy()
    expect(dialog.getByText('Dennis Roth')).toBeTruthy()

    fireEvent.click(dialog.getByRole('button', { name: 'Prüfung anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([{ method: 'POST', path: '/activities', body: { dutyId: 'd-1' } }])
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pruefungen/v-new')
    })
  })

  it('calls the activity of a duty that has something maintained a maintenance', async () => {
    await opened('site_management', duty({ kind: null, kindVersion: null, task: 'maintenance' }))

    expect(await screen.findByRole('button', { name: 'Wartung anlegen' })).toBeTruthy()
  })

  it.each([
    ['technician', {}],
    ['site_management', { state: 'dormant' }],
    ['site_management', { ended: true, endsOn: '2026-09-01' }],
    // Until its kind is known, so is not what its activity would be.
    ['site_management', { kind: 'probe.unknown_kind', kindVersion: 1 }],
  ] as const)('offers "%s" no activity for a duty (%#)', async (role, further) => {
    await opened(role, duty(further))
    await untilTheRightsAreKnown()
    await screen.findByText(fromTheCatalogue)

    expect(screen.queryByRole('button', { name: /anlegen$/ })).toBeNull()
  })

  it('shows what the server refuses with, and keeps the dialog open', async () => {
    const refusal = 'Für diese Pflicht läuft schon ein Vorgang.'

    answerToWrite = answering({ message: refusal }, 409)
    await opened('site_management')
    fireEvent.click(await screen.findByRole('button', { name: 'Prüfung anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Prüfung anlegen' }))

    fireEvent.click(dialog.getByRole('button', { name: 'Prüfung anlegen' }))
    await dialog.findByText(refusal)
  })
})
