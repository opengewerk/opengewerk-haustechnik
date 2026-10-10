import {
  addDays,
  type IsoDate,
  type RoleKey,
  type RoundDetails,
  type RoundTemplateId,
  type SignedPage,
  templateFormKey,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fingerprintOf } from '../../app/signing.js'
import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { pdfWords } from '../pdf-button.js'
import {
  mountOffice,
  type NamedArea,
  noRenderer,
  rowsOf,
  servingPdf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { roundWords } from './round.js'

/**
 * A round in the office (#115, section 4.5 of the concept): the page that
 * was signed, with each answer and what came of it, the signature and the
 * countersignature the template asks for, given for the page as it is
 * shown; and a round of a past day closed with the reason. Whoever only
 * performs countersigns nothing and closes nothing.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const place = { propertyId: 'p-school', areaId: nord.id }
const templateId = 'f0000000-0000-4000-8000-000000000115' as RoundTemplateId

const duty = {
  id: 'd-temperature',
  ...place,
  assetId: 'as-heater',
  roomId: null,
  kind: null,
  kindVersion: null,
  label: 'Temperatur am Speicheraustritt',
  endsOn: null,
}
const definition = {
  title: 'Technikzentrale Schulhaus',
  sections: [
    {
      key: 'k1',
      title: 'Heizraum E.14',
      fields: [
        {
          kind: 'measurement',
          key: 'p1',
          label: 'Temperatur am Speicheraustritt',
          unit: 'degrees_celsius',
          decimals: 1,
          required: true,
          limit: { kind: 'stated', bound: 'at_least', milli: 60_000, source: 'DVGW W 551' },
          fulfils: duty.id,
        },
        { kind: 'check_point', key: 'p2', label: 'Tür schließt selbsttätig', required: true },
      ],
    },
  ],
}

const answer = { groupKey: null, blockKey: null, attachmentId: null }
const page: SignedPage = {
  activity: {
    id: 'r-school',
    kind: 'round',
    title: 'Technikzentrale Schulhaus',
    performedOn: '2026-10-05' as IsoDate,
  },
  place: {
    property: {
      name: 'Schulzentrum Am Lindenhain',
      address: 'Am Lindenhain 7, 00003 Musterhausen',
    },
    building: { name: 'Schulhaus', shortCode: null },
    room: null,
    asset: null,
  },
  duties: [],
  defects: [],
  form: { key: templateFormKey(templateId), version: 3 },
  answers: [
    { ...answer, fieldKey: 'p1', value: '61000', result: null, remark: null },
    {
      ...answer,
      fieldKey: 'p2',
      value: null,
      result: 'not_ok',
      remark: 'Türschließer ohne Funktion, die Tür bleibt offen stehen.',
    },
  ],
}

const awaiting: RoundDetails = {
  id: 'r-school',
  planId: 'plan-school',
  title: 'Technikzentrale Schulhaus',
  status: 'signed',
  state: 'awaiting_countersignature',
  dueOn: '2026-10-05' as IsoDate,
  performedOn: '2026-10-05' as IsoDate,
  ...place,
  buildingId: 'b-house',
  performer: { userId: 'u-tobias', name: 'Tobias Wendt' },
  countersignatureRequired: true,
  formKey: templateFormKey(templateId),
  formVersion: 3,
  closingReason: null,
  page,
  signatures: [
    {
      id: 's-1',
      role: 'signer',
      name: 'Tobias Wendt',
      signedAt: '2026-10-05T05:38:00.000Z',
      deviceInfo: 'Telefon',
      path: 'M10,10L200,300',
      typedName: null,
      valid: true,
    },
  ],
  defects: [
    {
      id: 'df-1',
      description: 'Tür schließt selbsttätig: Türschließer ohne Funktion.',
      defectClass: null,
      status: 'found',
      roomId: null,
      assetId: null,
    },
  ],
  evidence: [],
}

/** A round of yesterday nobody has signed, open from before. */
const late: RoundDetails = {
  ...awaiting,
  id: 'r-late',
  status: 'open',
  state: 'open',
  dueOn: addDays(today() as IsoDate, -1),
  performedOn: null,
  page: null,
  signatures: [],
  defects: [],
}

const closed: RoundDetails = {
  ...late,
  id: 'r-closed',
  status: 'not_performed',
  state: 'not_performed',
  closingReason: 'Die Wache war wegen einer Übung nicht besetzt.',
}

const everything = [
  'properties',
  'buildings',
  'assets',
  'rooms',
  'duties',
  'round_templates',
  'round_template_versions',
]

let server: TestServer
let answerToWrite: (write: Written) => WriteAnswer
let written: Written[]

function signedIn(role: RoleKey, rounds: readonly RoundDetails[] = [awaiting, late, closed]) {
  written = signedInOffice(
    role,
    [nord],
    {
      ...servingCatalogue(testCatalogue),
      ...Object.fromEntries(rounds.map((round) => [`/rounds/${round.id}`, round])),
    },
    (write) => answerToWrite(write),
  )
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  server.put('duties', duty)
  server.put('round_templates', {
    id: templateId,
    title: 'Technikzentrale Schulhaus',
    sourceKey: null,
    sourceVersion: null,
  })
  server.put('round_template_versions', {
    id: 'v-3',
    templateId,
    formVersion: 3,
    definition: JSON.stringify(definition),
    asksCountersignature: true,
    createdAt: '2026-09-14T08:00:00.000Z',
  })
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })
  signedIn('site_management')
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const answersCaption = 'Die Antworten des Rundgangs, wie er unterschrieben wurde'

/** Draws a stroke into the field for the countersignature. */
function draw() {
  const field = screen.getByRole('img', { name: roundWords.pad })

  Object.assign(field, {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 200,
      right: 500,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setPointerCapture: () => undefined,
  })
  fireEvent.pointerDown(field, { pointerId: 1, clientX: 50, clientY: 150 })
  fireEvent.pointerMove(field, { pointerId: 1, clientX: 120, clientY: 60 })
  fireEvent.pointerMove(field, { pointerId: 1, clientX: 200, clientY: 140 })
  fireEvent.pointerUp(field, { pointerId: 1, clientX: 200, clientY: 140 })
}

describe('a round that was signed', () => {
  it('shows each answer as it was signed, what was said with it and what came of it', async () => {
    await mountOffice('/rundgaenge/r-school', server, everything)
    await screen.findByRole('heading', { name: 'Technikzentrale Schulhaus', level: 1 })

    await waitFor(() => {
      expect(rowsOf(answersCaption)).toEqual([
        ['Heizraum E.14'],
        [
          'Temperatur am Speicheraustritt',
          '61,0 °C',
          'Innerhalb des Grenzwerts, mindestens 60,0 °C.erfüllt die Pflicht „Temperatur am Speicheraustritt“',
        ],
        [
          'Tür schließt selbsttätig',
          'Nicht in Ordnung',
          'Türschließer ohne Funktion, die Tür bleibt offen stehen.wurde mit der Unterschrift ein Mangel',
        ],
      ])
    })

    const duties = screen.getByRole('region', { name: 'Pflichten aus diesem Rundgang' })

    expect(duties.textContent).toBe(
      `Pflichten aus diesem RundgangTemperatur am Speicheraustritt${roundWords.dutyWithCounter}`,
    )
    expect(screen.getByRole('region', { name: 'Mangel daraus' }).textContent).toContain(
      'Tür schließt selbsttätig: Türschließer ohne Funktion.',
    )
    expect(screen.getByRole('region', { name: 'Unterschrift' }).textContent).toContain(
      'Tobias Wendt',
    )
  })

  it('is countersigned for the page as it is shown, by whoever countersigns rounds', async () => {
    answerToWrite = () => ({
      status: 201,
      body: { ...awaiting, status: 'done', state: 'submitted' },
    })
    await mountOffice('/rundgaenge/r-school', server, everything)

    const countersign = await screen.findByRole('button', { name: roundWords.countersign })

    // Without a drawing nothing is sent.
    fireEvent.click(countersign)
    expect((await screen.findByRole('alert')).textContent).toBe(roundWords.noPath)
    expect(written).toEqual([])

    draw()
    fireEvent.click(countersign)

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toMatchObject({
      method: 'POST',
      path: '/rounds/r-school/countersignature',
      body: {
        path: expect.stringMatching(/^M/),
        pageFingerprint: await fingerprintOf(page),
      },
    })
  })

  it('is countersigned without a drawing, with the own name typed and the keyboard alone (#209)', async () => {
    const user = userEvent.setup()

    answerToWrite = () => ({
      status: 201,
      body: { ...awaiting, status: 'done', state: 'submitted' },
    })
    await mountOffice('/rundgaenge/r-school', server, everything)

    const countersign = await screen.findByRole('button', { name: roundWords.countersign })

    // The pad takes a finger or a pen; the keyboard reaches the way beside it.
    screen.getByRole('button', { name: 'Ohne Schriftzug unterschreiben' }).focus()
    await user.keyboard('{Enter}')

    const name = screen.getByRole('textbox', { name: 'Ihr Name' })

    // The keyboard that pressed the button types here next.
    expect(document.activeElement).toBe(name)
    expect(screen.queryByRole('img', { name: roundWords.pad })).toBeNull()

    // The name of somebody else confirms nothing, and nothing is sent.
    await user.keyboard('Tobias Wendt')
    await user.tab()
    expect(
      screen.getByText('Bestätigt wird mit dem eigenen Namen, wie er im Konto steht: Pia Person.'),
    ).toBeDefined()
    await user.tab()
    expect(document.activeElement).toBe(countersign)
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(roundWords.noPath)
    expect(written).toEqual([])

    // The own name counts, whatever the case and the spaces.
    await user.clear(name)
    await user.keyboard(' pia   Person ')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toMatchObject({
      method: 'POST',
      path: '/rounds/r-school/countersignature',
      body: { path: null, typedName: 'pia Person', pageFingerprint: await fingerprintOf(page) },
    })
  })

  it('shows a signature confirmed with the typed name as the name, and says so (#209)', async () => {
    signedIn('site_management', [
      {
        ...awaiting,
        status: 'done',
        state: 'submitted',
        signatures: [
          ...awaiting.signatures,
          {
            id: 's-2',
            role: 'countersigner',
            name: 'Dennis Roth',
            signedAt: '2026-10-05T08:14:00.000Z',
            deviceInfo: 'Firefox',
            path: null,
            typedName: 'Dennis Roth',
            valid: true,
          },
        ],
      },
    ])
    await mountOffice('/rundgaenge/r-school', server, everything)

    const counter = await screen.findByRole('region', { name: 'Gegenzeichnung' })

    expect(
      within(counter).getByRole('img', {
        name: 'Unterschrift von Dennis Roth, mit getipptem Namen bestätigt',
      }).textContent,
    ).toBe('Dennis Roth')
    expect(counter.textContent).toContain('mit getipptem Namen bestätigt')
    expect(
      within(screen.getByRole('region', { name: 'Unterschrift' })).getByRole('img', {
        name: 'Unterschrift von Tobias Wendt',
      }),
    ).toBeDefined()
  })

  it('says why the server did not take the countersignature', async () => {
    answerToWrite = () => ({
      status: 409,
      body: {
        message:
          'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
      },
    })
    await mountOffice('/rundgaenge/r-school', server, everything)
    await screen.findByRole('button', { name: roundWords.countersign })

    draw()
    fireEvent.click(screen.getByRole('button', { name: roundWords.countersign }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
    )
  })

  it('offers no countersignature to whoever only performs', async () => {
    signedIn('technician')
    await mountOffice('/rundgaenge/r-school', server, everything)
    await untilTheRightsAreKnown()

    const counter = await screen.findByRole('region', { name: 'Gegenzeichnung' })

    expect(counter.textContent).toBe(`Gegenzeichnung${roundWords.counterWaits}`)
    expect(screen.queryByRole('img', { name: roundWords.pad })).toBeNull()
  })
})

describe('the PDF of a round (#111)', () => {
  it('is offered once the round is written down, and opens in a tab of its own', async () => {
    signedIn('technician', [{ ...awaiting, status: 'done', state: 'submitted' }])
    await mountOffice('/rundgaenge/r-school', server, everything)

    const pdf = servingPdf()

    fireEvent.click(await screen.findByRole('button', { name: pdfWords.open }))

    await waitFor(() => {
      expect(pdf.opened).toEqual(['blob:probe'])
    })
    expect(pdf.asked).toEqual(['/rounds/r-school/pdf'])
  })

  it('is not offered before: the state is frozen when the round is written down', async () => {
    await mountOffice('/rundgaenge/r-school', server, everything)
    await screen.findByRole('button', { name: roundWords.countersign })

    expect(screen.queryByRole('button', { name: pdfWords.open })).toBeNull()
  })

  it('says why there is none where the instance makes none', async () => {
    signedIn('management', [{ ...awaiting, status: 'done', state: 'submitted' }])
    await mountOffice('/rundgaenge/r-school', server, everything)
    servingPdf(noRenderer)

    fireEvent.click(await screen.findByRole('button', { name: pdfWords.open }))

    expect(await screen.findByText(noRenderer)).toBeDefined()
  })
})

describe('a round nobody signed', () => {
  it('shows no answers before the signature, and is closed with the reason by whoever plans', async () => {
    answerToWrite = () => ({ status: 201, body: closed })
    await mountOffice('/rundgaenge/r-late', server, everything)

    expect(await screen.findByText(roundWords.notHandedIn)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: roundWords.close }))

    const dialog = await screen.findByRole('dialog', { name: roundWords.closeTitle })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }))
    expect(
      await within(dialog).findByText(
        'Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.',
      ),
    ).toBeTruthy()
    expect(written).toEqual([])

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Grund/ }),
      'Die Wache war wegen einer Übung nicht besetzt.',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/rounds/r-late/close',
          body: { closingReason: 'Die Wache war wegen einer Übung nicht besetzt.' },
        },
      ])
    })
  })

  it('is not closed by whoever only performs', async () => {
    signedIn('technician')
    await mountOffice('/rundgaenge/r-late', server, everything)
    await untilTheRightsAreKnown()
    await screen.findByText(roundWords.notHandedIn)

    expect(screen.queryByRole('button', { name: roundWords.close })).toBeNull()
  })

  it('is not closed while its day has not passed: it is still to be walked', async () => {
    signedIn('site_management', [{ ...late, dueOn: today() as IsoDate }])
    await mountOffice('/rundgaenge/r-late', server, everything)
    await untilTheRightsAreKnown()
    await screen.findByText(roundWords.notHandedIn)

    expect(screen.queryByRole('button', { name: roundWords.close })).toBeNull()
  })

  it('stays readable once closed, with the reason, and fulfils nothing', async () => {
    await mountOffice('/rundgaenge/r-closed', server, everything)

    const reason = await screen.findByRole('region', { name: 'Nicht durchgeführt' })

    expect(reason.textContent).toContain('Die Wache war wegen einer Übung nicht besetzt.')
    expect(reason.textContent).toContain(roundWords.notPerformed)
    expect(
      (await screen.findByRole('region', { name: 'Pflichten aus diesem Rundgang' })).textContent,
    ).toBe(`Pflichten aus diesem RundgangTemperatur am Speicheraustritt${roundWords.dutyStaysDue}`)
    expect(screen.getByRole('region', { name: 'Gegenzeichnung' }).textContent).toBe(
      `Gegenzeichnung${roundWords.counterClosed}`,
    )
    expect(screen.queryByRole('button', { name: roundWords.close })).toBeNull()
  })
})
