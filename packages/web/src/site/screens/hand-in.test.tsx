import 'fake-indexeddb/auto'

import { today } from '@opengewerk/platform-web/format'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import { formCatalogue, heaterDuty, lineOf, round } from '../test-form.js'
import {
  afterEachSiteTest,
  goOffline,
  goOnline,
  heater,
  mountSite,
  queued,
  schoolServer,
} from '../test-site.js'

/**
 * The end of a round on site (#114), the boards "Abgabe erst vollständig",
 * "Unterschrift" and "Abgegeben, wartet auf Gegenzeichnung": handed in only
 * once every point has its answer, signed for exactly the page that is shown,
 * and from the first answer to the signature without a network.
 */

afterEach(afterEachSiteTest)

const withTheForm = { answers: servingCatalogue(formCatalogue) }

const template = '0192f0c4-7b4e-7000-8000-0000000000c2'

/** A template of the operator with a check point that fulfils the duty of the heater, a measured value, a reading and a photo. */
const version = {
  id: 'rv-1',
  templateId: template,
  formVersion: 1,
  asksCountersignature: true,
  definition: JSON.stringify({
    title: 'Technikzentrale',
    sections: [
      {
        key: 'k1',
        title: 'Heizraum E.14',
        fields: [
          {
            kind: 'check_point',
            key: 'tight',
            label: 'Speicher dicht',
            about: { kind: 'asset', id: heater.id },
            fulfils: heaterDuty.id,
          },
          {
            kind: 'measurement',
            key: 'outlet',
            label: 'Temperatur am Speicheraustritt',
            unit: 'degrees_celsius',
            decimals: 1,
            required: true,
            limit: { kind: 'at_least', rule: 'probe.hot_water_minimum' },
            about: { kind: 'asset', id: heater.id },
          },
          {
            kind: 'meter_reading',
            key: 'heat_meter',
            label: 'Wärmemengenzähler',
            unit: 'megawatt_hours',
            decimals: 2,
            required: true,
          },
          { kind: 'photo', key: 'displays', label: 'Foto der Anzeigen', required: true },
        ],
      },
    ],
  }),
}

/** A round of a plan, given to nobody, today, on that template, and countersigned. */
const planned = {
  ...round,
  id: 'ac-planned',
  title: 'Technikzentrale Schulhaus',
  formKey: `template-${template}`,
  formVersion: 1,
  countersignatureRequired: true,
  performer: 'own_staff',
  performerUserId: null,
  responsibleUserId: null,
  dueOn: today(),
}

function roundServer(
  answers: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
  activity: Readonly<Record<string, unknown>> = {},
) {
  const server = schoolServer()

  server.put('duties', heaterDuty)
  server.put('round_template_versions', version)
  server.put('activities', { ...planned, ...activity })
  server.put('activity_duties', lineOf(planned.id))

  for (const [key, values] of Object.entries(answers)) {
    server.put('activity_answers', {
      id: `an-${key}`,
      propertyId: planned.propertyId,
      areaId: planned.areaId,
      activityId: planned.id,
      groupKey: null,
      blockKey: null,
      fieldKey: key,
      value: null,
      result: null,
      remark: null,
      attachmentId: null,
      ...values,
    })
  }

  return server
}

/** Signs in the pad with a finger, three points of one stroke. */
function draw() {
  const field = screen.getByRole('img', { name: 'Feld für die Unterschrift' })

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

const handIn = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Abgeben und unterschreiben' })

/** Types into a box and leaves it, which is when a value is written. */
async function type(name: string | RegExp, value: string) {
  const box = await screen.findByRole('textbox', { name })

  fireEvent.change(box, { target: { value } })
  fireEvent.blur(box)
}

async function onward(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: label }))
}

describe('handing in a round', () => {
  it('is not possible while a point lacks its answer, or the remark its answer asks for', async () => {
    const { router } = await mountSite(`/vorgaenge/${planned.id}/abgabe`, {
      server: roundServer({
        tight: { result: 'not_ok' },
        outlet: { value: '61000' },
        heat_meter: { value: '1284360' },
      }),
      ...withTheForm,
    })

    const missing = await screen.findByRole('list', { name: 'Noch ohne Antwort:' })

    expect(
      within(missing)
        .getAllByRole('link')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Speicher dichtDie Bemerkung fehlt'),
      expect.stringContaining('Foto der AnzeigenHeizraum E.14, Punkt 4'),
    ])
    expect(screen.getByText('3 von 4 Punkten, davon 1 „nicht in Ordnung“')).toBeDefined()
    expect(screen.getByText('verlangt, durch die Objektleitung')).toBeDefined()
    expect(handIn().disabled).toBe(true)

    // Nor by the address of the signature: it is the handing in until nothing lacks.
    await router.navigate({ to: `/vorgaenge/${planned.id}/unterschrift` })

    expect(await screen.findByRole('list', { name: 'Noch ohne Antwort:' })).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Feld für die Unterschrift' })).toBeNull()
  })

  it('is not offered to whoever does not perform activities, however complete the round is', async () => {
    const { router } = await mountSite(`/vorgaenge/${planned.id}/abgabe`, {
      server: roundServer({
        tight: { result: 'ok' },
        outlet: { value: '61000' },
        heat_meter: { value: '1284360' },
        displays: { attachmentId: 'at-displays' },
      }),
      rights: memberIn('technician').rights.filter((right) => right !== 'activity.perform'),
      ...withTheForm,
    })

    expect(
      await screen.findByText('Antworten geben gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeDefined()
    expect(screen.queryByRole('list', { name: 'Noch ohne Antwort:' })).toBeNull()
    expect(handIn().disabled).toBe(true)

    await router.navigate({ to: `/vorgaenge/${planned.id}/unterschrift` })

    expect(await screen.findByRole('button', { name: 'Abgeben und unterschreiben' })).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Feld für die Unterschrift' })).toBeNull()
  })

  it('says under a point the duty it fulfils, and that the duty stays due when it could not be checked', async () => {
    await mountSite(`/vorgaenge/${planned.id}/punkte/tight`, {
      server: roundServer(),
      ...withTheForm,
    })

    expect(await screen.findByText('erfüllt Prüfung des Speichers')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))

    expect(
      await screen.findByText(
        '„Entfällt“ und „nicht möglich“ sind Antworten und verlangen einen Grund. Die Pflicht „Prüfung des Speichers“ bleibt dann fällig.',
      ),
    ).toBeDefined()
  })

  it('goes without a network from the first answer to the signature, and the device sends it all afterwards', async () => {
    const server = roundServer()
    const { router } = await mountSite('/', { server, ...withTheForm })

    goOffline(server)

    fireEvent.click(await screen.findByRole('link', { name: /Technikzentrale Schulhaus/ }))
    await onward('Weiter: Heizraum E.14')

    // A check point not in order, with its remark.
    expect(await screen.findByText('Punkt 1 von 4')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Nicht in Ordnung' }))
    await type('Bemerkung, verlangt', 'Dichtung am Flansch tropft.')
    await onward('Weiter')

    // A measured value under its limit, with its remark.
    expect(await screen.findByText('Punkt 2 von 4')).toBeDefined()
    await type('Temperatur am Speicheraustritt in °C', '55,5')
    await type('Bemerkung, verlangt', 'Nach zehn Minuten nachgemessen.')
    await onward('Weiter')

    // A reading.
    expect(await screen.findByText('Punkt 3 von 4')).toBeDefined()
    await type('Wärmemengenzähler in MWh', '1.284,36')
    await onward('Weiter')

    // A photo, and the end of the round is its handing in.
    expect(await screen.findByText('Punkt 4 von 4')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Foto der Anzeigen'), {
      target: { files: [new File(['kessel'], 'anzeigen.jpg', { type: 'image/jpeg' })] },
    })
    await screen.findByRole('img', { name: 'Foto zu Foto der Anzeigen' })
    await onward('Zur Abgabe')

    await waitFor(() => {
      expect(handIn().disabled).toBe(false)
    })
    fireEvent.click(handIn())

    const signed = await screen.findByRole('list', { name: 'Was Sie unterschreiben' })

    expect(within(signed).getAllByRole('listitem')).toHaveLength(4)
    expect(
      screen.getByText(
        '2 Mängel: Speicher dicht an AN-00057 Aufzug Heizraum; Temperatur am Speicheraustritt an AN-00057 Aufzug Heizraum. Die Nachweise entstehen mit der Gegenzeichnung.',
      ),
    ).toBeDefined()

    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Abgegeben' })).toBeDefined()
    expect(router.state.location.pathname).toBe(`/vorgaenge/${planned.id}/abgabe`)
    expect(screen.getByText('Wartet auf die Gegenzeichnung der Objektleitung.')).toBeDefined()
    expect(screen.getByText(/wartet auf die Übertragung$/)).toBeDefined()
    expect(
      within(screen.getByRole('list', { name: 'Festgestellt' }))
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'Dichtung am Flansch tropft.Mangel an AN-00057 Aufzug Heizraum',
      'Nach zehn Minuten nachgemessen.Mangel an AN-00057 Aufzug Heizraum',
    ])
    // Nothing of it has reached the server in the cellar.
    expect(queued(server)).toEqual([])

    // Signed, the address of the signature says so and offers no second one.
    await router.navigate({ to: `/vorgaenge/${planned.id}/unterschrift` })

    expect(
      await screen.findByText('Wartet auf die Gegenzeichnung der Objektleitung.'),
    ).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Feld für die Unterschrift' })).toBeNull()

    goOnline(server)

    expect(await screen.findByText(/, übertragen$/)).toBeDefined()

    const sent = queued(server)

    // Begun first, then the answers and the photo, the signature last, for the page shown.
    expect(sent[0]).toMatchObject({
      entity: 'activities',
      kind: 'update',
      values: { status: 'started', performedOn: today() },
    })
    expect(
      new Set(
        sent
          .filter((each) => each.entity === 'activity_answers' && each.kind === 'create')
          .map((each) => each.values['fieldKey']),
      ),
    ).toEqual(new Set(['tight', 'outlet', 'heat_meter', 'displays']))
    expect(sent.some((each) => each.entity === 'attachments')).toBe(true)
    expect(sent.at(-1)).toMatchObject({
      entity: 'activity_signatures',
      kind: 'create',
      values: { activityId: planned.id, role: 'signer' },
    })
    expect(String(sent.at(-1)?.values['pageFingerprint'])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('says a round is done once the server wrote it down, signed where no countersignature is asked', async () => {
    const server = roundServer({}, { status: 'done', countersignatureRequired: false })

    server.put('activity_signatures', {
      id: 'sg-1',
      propertyId: planned.propertyId,
      areaId: planned.areaId,
      activityId: planned.id,
      signedBy: 'u-1',
      role: 'signer',
      signedAt: `${today()}T07:38:00.000Z`,
      deviceInfo: null,
      path: 'M10,10L20,20',
      pageFingerprint: '0'.repeat(64),
    })
    await mountSite(`/vorgaenge/${planned.id}/abgabe`, { server, ...withTheForm })

    expect(await screen.findByText('Der Rundgang ist erledigt.')).toBeDefined()
    expect(screen.getByText(/, übertragen$/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Zum Start' })).toBeDefined()
  })
})
