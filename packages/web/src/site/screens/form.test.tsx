import { type BlockFieldKind, blockFieldKinds } from '@opengewerk/haustechnik-domain'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import { formCatalogue, kindsInTheForm, round, technicalRoom } from '../test-form.js'
import {
  afterEachSiteTest,
  goOffline,
  goOnline,
  mountSite,
  queued,
  schoolServer,
} from '../test-site.js'

/**
 * The form of an activity on site (#107): every kind of field drawn, every
 * answer written as it is given, also without a network, and nothing
 * offered to whoever may not answer or once the activity is done.
 */

afterEach(afterEachSiteTest)

const withTheForm = { answers: servingCatalogue(formCatalogue) }

function serverWith(...answers: readonly Readonly<Record<string, unknown>>[]) {
  const server = schoolServer()

  server.put('activities', round)

  for (const answer of answers) {
    server.put('activity_answers', {
      propertyId: round.propertyId,
      areaId: round.areaId,
      activityId: round.id,
      groupKey: null,
      blockKey: null,
      value: null,
      result: null,
      remark: null,
      attachmentId: null,
      ...answer,
    })
  }

  return server
}

const point = (key: string) => `/vorgaenge/${round.id}/punkte/${key}`

/** The answers the device holds for the round, as entity rows. */
function answersOn(client: { list: (entity: string) => readonly Record<string, unknown>[] }) {
  return client.list('activity_answers').filter((answer) => answer['activityId'] === round.id)
}

/** The fields of the form outside groups, in the order its points stand while no group has a block. */
const fieldsInOrder = technicalRoom.sections
  .flatMap((section) => section.fields)
  .filter((field) => field.kind !== 'group' && field.kind !== 'signature')

/** The input each kind of field is answered with, found by what a reader hears it called. */
const inputOf: Readonly<Record<BlockFieldKind, (label: string) => HTMLElement>> = {
  text: (label) => screen.getByRole('textbox', { name: label }),
  number: (label) => screen.getByRole('textbox', { name: new RegExp(`^${label} in `) }),
  measurement: (label) => screen.getByRole('textbox', { name: new RegExp(`^${label} in `) }),
  choice: (label) => screen.getByRole('group', { name: label }),
  yes_no: (label) =>
    within(screen.getByRole('group', { name: label })).getByRole('radio', { name: 'ja' }),
  photo: (label) => screen.getByLabelText(label),
  check_point: (label) =>
    within(screen.getByRole('group', { name: label })).getByRole('button', { name: 'In Ordnung' }),
  meter_reading: (label) => screen.getByRole('textbox', { name: new RegExp(`^${label} in `) }),
}

describe('the form of an activity on site', () => {
  it('draws every kind of field the forms of this application have', async () => {
    expect(kindsInTheForm).toEqual([...blockFieldKinds])

    await mountSite(point('outlet'), { server: serverWith(), ...withTheForm })

    const seen: BlockFieldKind[] = []

    for (;;) {
      const sub = await screen.findByText(/^Punkt \d+ von \d+$/)
      const field = fieldsInOrder[Number(/\d+/.exec(sub.textContent ?? '')?.[0]) - 1]

      if (field === undefined) {
        throw new Error(`The form has no point at ${String(sub.textContent)}.`)
      }

      expect(await waitFor(() => inputOf[field.kind](field.label))).toBeDefined()
      seen.push(field.kind)

      if (screen.queryByRole('button', { name: 'Weiter' }) === null) {
        break
      }

      const before = sub.textContent
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await waitFor(() => {
        expect(screen.getByText(/^Punkt \d+ von \d+$/).textContent).not.toBe(before)
      })
    }

    expect([...seen].sort()).toEqual([...blockFieldKinds].sort())
  })

  it('writes a check point with the remark given before its answer, and changes it after', async () => {
    const { client } = await mountSite(point('door_closes'), {
      server: serverWith(),
      ...withTheForm,
    })

    const remark = await screen.findByRole('textbox', { name: 'Bemerkung' })

    // Written down first and left, before there is an answer to go with.
    fireEvent.change(remark, { target: { value: 'Der Schließer hängt.' } })
    fireEvent.blur(remark)
    fireEvent.click(screen.getByRole('button', { name: 'Nicht in Ordnung' }))

    await waitFor(() => {
      expect(answersOn(client)).toMatchObject([
        { fieldKey: 'door_closes', result: 'not_ok', remark: 'Der Schließer hängt.' },
      ])
    })
    expect(
      screen.getByText(
        'Wird mit der Unterschrift ein Mangel an Raum E.14 Heizraum. Klasse und Frist setzt, wer Mängel führt.',
      ),
    ).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'In Ordnung' }))
    fireEvent.click(screen.getByRole('button', { name: 'Entfällt' }))

    await waitFor(() => {
      expect(answersOn(client)).toMatchObject([
        { fieldKey: 'door_closes', result: 'not_applicable' },
      ])
    })
    expect(screen.getByRole('textbox', { name: 'Grund, verlangt' })).toBeDefined()
  })

  it('asks the reason of an answer that the point was not possible', async () => {
    await mountSite(point('door_closes'), { server: serverWith(), ...withTheForm })

    fireEvent.click(await screen.findByRole('button', { name: 'Nicht möglich' }))

    expect(await screen.findByText('„Nicht möglich“ verlangt einen Grund.')).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Grund, verlangt' })).toBeDefined()
  })

  it('judges a measured value against its rule and writes it in thousandths', async () => {
    const { client } = await mountSite(point('outlet'), { server: serverWith(), ...withTheForm })
    const box = await screen.findByRole('textbox', { name: 'Temperatur am Speicheraustritt in °C' })

    expect(screen.getByText('≥ 60,0 °C')).toBeDefined()

    fireEvent.change(box, { target: { value: '55,5' } })
    fireEvent.blur(box)

    await waitFor(() => {
      expect(answersOn(client)).toMatchObject([{ fieldKey: 'outlet', value: '55500' }])
    })
    expect(await screen.findByText(/Quelle: DVGW-Arbeitsblatt W 551\.$/)).toBeDefined()
    expect(
      screen.getByText(
        'Mit der Unterschrift wird daraus ein Mangel an AN-00057 Aufzug Heizraum, wie bei „nicht in Ordnung“.',
      ),
    ).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Bemerkung, verlangt' })).toBeDefined()
  })

  it('keeps yes and no as the values true and false', async () => {
    const { client } = await mountSite(point('log_book'), { server: serverWith(), ...withTheForm })

    fireEvent.click(await screen.findByRole('radio', { name: 'nein' }))

    await waitFor(() => {
      expect(answersOn(client)).toMatchObject([{ fieldKey: 'log_book', value: 'false' }])
    })
  })

  it('takes a value back once its box is emptied', async () => {
    const { client } = await mountSite(point('heat_meter'), {
      server: serverWith({ id: 'an-meter', fieldKey: 'heat_meter', value: '1284360' }),
      ...withTheForm,
    })
    const box = await screen.findByRole('textbox', { name: 'Wärmemengenzähler Schulhaus in MWh' })

    expect((box as HTMLInputElement).value).toBe('1.284,36')

    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)

    await waitFor(() => {
      expect(answersOn(client)).toEqual([])
    })
  })

  it('keeps what was typed when the page is closed without a network', async () => {
    const server = serverWith()
    const first = await mountSite(point('noticed'), {
      server,
      store: 'form-closed',
      ...withTheForm,
    })

    goOffline(server)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Sonst aufgefallen' }), {
      target: { value: 'Kondenswasser unter dem Kessel.' },
    })
    // The page goes before the moment after the last key has passed: the
    // browser says so, and what was typed is written as it goes.
    window.dispatchEvent(new Event('pagehide'))
    // At once, and not a moment after the last key, which a closed page never sees.
    await waitFor(
      () => {
        expect(answersOn(first.client)).toHaveLength(1)
      },
      { timeout: 200 },
    )
    cleanup()
    first.client.stop()
    goOnline(server)
    afterEachSiteTest()

    await mountSite(point('noticed'), { server, store: 'form-closed', ...withTheForm })

    expect(
      (await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Sonst aufgefallen' }))
        .value,
    ).toBe('Kondenswasser unter dem Kessel.')
    await waitFor(() => {
      expect(queued(server)).toContainEqual({
        entity: 'activity_answers',
        kind: 'create',
        values: expect.objectContaining({
          fieldKey: 'noticed',
          value: '"Kondenswasser unter dem Kessel."',
        }) as unknown,
      })
    })
  })

  it('offers no answer to whoever does not perform activities', async () => {
    await mountSite(point('door_closes'), {
      server: serverWith(),
      rights: memberIn('technician').rights.filter((right) => right !== 'activity.perform'),
      ...withTheForm,
    })

    expect(
      await screen.findByText('Antworten geben gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeDefined()
    expect(
      (screen.getByRole('button', { name: 'Nicht in Ordnung' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('offers no answer once the activity is signed', async () => {
    const server = serverWith()

    server.put('activities', { ...round, status: 'signed' })
    await mountSite(point('outlet'), { server, ...withTheForm })

    expect(
      await screen.findByText(
        'Dieser Vorgang ist abgeschlossen. Seine Antworten lassen sich nicht mehr ändern.',
      ),
    ).toBeDefined()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Temperatur am Speicheraustritt in °C',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true)
  })
})

describe('the points of a form on site', () => {
  it('counts what has to be answered and leads to the first point still open', async () => {
    const { router } = await mountSite(`/vorgaenge/${round.id}`, {
      server: serverWith({
        id: 'an-door',
        fieldKey: 'door_closes',
        result: 'not_ok',
        remark: 'Hängt.',
      }),
      ...withTheForm,
    })

    expect(await screen.findByText('1 von 3 Pflichtpunkten beantwortet')).toBeDefined()
    expect(
      within(screen.getByRole('link', { name: /Tür schließt selbsttätig/ })).getByText(
        'Nicht in Ordnung',
      ),
    ).toBeDefined()
    expect(
      within(screen.getByRole('link', { name: /Sonst aufgefallen/ })).getByText('freiwillig'),
    ).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Heizraum E.14' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${round.id}/punkte/outlet`)
    })
  })

  it('opens a block of a group and writes its answer under it', async () => {
    const { client } = await mountSite(`/vorgaenge/${round.id}`, {
      server: serverWith(),
      ...withTheForm,
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Leuchte hinzufügen' }))
    expect(await screen.findByRole('heading', { name: 'Leuchte 1' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'In Ordnung' }))

    await waitFor(() => {
      expect(answersOn(client)).toMatchObject([
        { groupKey: 'lights', fieldKey: 'lights_up', result: 'ok' },
      ])
    })
    expect(String(answersOn(client)[0]?.['blockKey'])).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('fills a round in the version of its template that it names, whatever was saved after it (#112)', async () => {
    const server = serverWith()
    const template = '0192f0c4-7b4e-7000-8000-0000000000c1'
    const version = (formVersion: number, label: string) => ({
      id: `v-${String(formVersion)}`,
      templateId: template,
      formVersion,
      asksCountersignature: false,
      definition: JSON.stringify({
        title: 'Technikzentrale',
        sections: [
          { key: 'k1', title: 'Heizraum', fields: [{ kind: 'check_point', key: 'p1', label }] },
        ],
      }),
    })

    server.put('round_template_versions', version(1, 'Tür schließt selbsttätig'))
    server.put('round_template_versions', version(2, 'Tür und Zarge geprüft'))
    server.put('activities', { ...round, formKey: `template-${template}`, formVersion: 1 })
    await mountSite(`/vorgaenge/${round.id}`, { server, ...withTheForm })

    expect(await screen.findByText('Tür schließt selbsttätig')).toBeDefined()
    expect(screen.queryByText('Tür und Zarge geprüft')).toBeNull()
  })

  it('says so where the device does not know the version of the form', async () => {
    const server = serverWith()

    server.put('activities', { ...round, formVersion: 9 })
    await mountSite(`/vorgaenge/${round.id}`, { server, ...withTheForm })

    expect(
      await screen.findByText(/in einer Fassung vor, die dieses Gerät nicht kennt/),
    ).toBeDefined()
  })
})
