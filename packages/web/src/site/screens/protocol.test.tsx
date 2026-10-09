import { createHash } from 'node:crypto'

import {
  canonicalForm,
  type FilledAnswer,
  signedPageOf,
  type SyncConflict,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import { formCatalogue, heaterDuty, inspection, maintenance, workServer } from '../test-form.js'
import {
  afterEachSiteTest,
  boilerRoom,
  goOffline,
  goOnline,
  heater,
  house,
  mountSite,
  queued,
  school,
} from '../test-site.js'

/**
 * An inspection on site (#108): the way to it from its asset, its protocol as
 * one list, its result with the signature for the page the device holds, all
 * of it also without a network, and a signature the server did not take.
 */

afterEach(afterEachSiteTest)

const withTheForm = { answers: servingCatalogue(formCatalogue) }

const result = (activityId: string) => `/vorgaenge/${activityId}/ergebnis`

const atTheSchool = { propertyId: school.id, areaId: school.areaId }

/** An answer to a point of the inspection, as the device is sent it. */
function answerOf(fieldKey: string, said: { value?: string; result?: string; remark?: string }) {
  return {
    id: `an-${fieldKey}`,
    ...atTheSchool,
    activityId: inspection.id,
    groupKey: null,
    blockKey: null,
    fieldKey,
    value: said.value ?? null,
    result: (said.result ?? null) as FilledAnswer['result'],
    remark: said.remark ?? null,
    attachmentId: null,
  }
}

/** The school with the inspection answered: the valve as given, the outlet at 65,0 °C. */
function answered(valve: { result: string; remark?: string } = { result: 'ok' }) {
  const server = workServer()

  server.put('activity_answers', answerOf('valve', valve))
  server.put('activity_answers', answerOf('outlet', { value: '65000' }))

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

function signButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Unterschreiben' })
}

function choose(words: string) {
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Ergebnis' })).getByRole('radio', {
      name: words,
    }),
  )
}

/** What the device holds of a kind of record for the inspection. */
function heldFor(
  client: { list: (entity: string) => readonly Record<string, unknown>[] },
  entity: string,
  activityId = inspection.id,
) {
  return client.list(entity).filter((record) => record['activityId'] === activityId)
}

describe('the way to an inspection on site', () => {
  it('leads from its asset to the inspections and maintenance the own people perform there, open or begun', async () => {
    const server = workServer()

    server.put('activities', { ...maintenance, status: 'started', performedOn: '2026-10-08' })
    server.put('activities', {
      ...inspection,
      id: 'ac-contractor',
      title: 'Prüfung durch die Fremdfirma',
      performer: 'contractor',
    })
    server.put('activities', { ...inspection, id: 'ac-done', title: 'Vorjahr', status: 'done' })
    server.put('activities', {
      ...inspection,
      id: 'ac-round-here',
      kind: 'round',
      title: 'Rundgang',
    })
    await mountSite(`/anlagen/${heater.id}`, { server, ...withTheForm })

    const work = await screen.findByRole('list', { name: 'Zu erledigen' })

    expect(
      within(work)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])
        .sort(),
    ).toEqual([
      ['Prüfung des SpeichersPrüfung, fällig am 20.10.2026offen', `/m/vorgaenge/${inspection.id}`],
      [
        'Wartung des SpeichersWartung, begonnen am 08.10.2026begonnen',
        `/m/vorgaenge/${maintenance.id}`,
      ],
    ])
  })

  it('is not there for whoever does not perform activities', async () => {
    await mountSite(`/anlagen/${heater.id}`, {
      server: workServer(),
      rights: memberIn('technician').rights.filter((right) => right !== 'activity.perform'),
      ...withTheForm,
    })

    // The page stands, with what is known about the asset.
    expect(await screen.findByText('Angaben')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Zu erledigen' })).toBeNull()
  })
})

describe('the protocol of an inspection', () => {
  it('stands as one list, every point with its input, and names the protocol it took as its template', async () => {
    const server = workServer()

    server.put('activities', { ...inspection, templateOn: '2025-10-14' })
    await mountSite(`/vorgaenge/${inspection.id}`, { server, ...withTheForm })

    expect(
      await screen.findByText(
        'Vorlage ist das Protokoll vom 14.10.2025: Angaben sind übernommen, Antworten und Messwerte werden neu erfasst.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        `Formular aus dem Paket ${formCatalogue.packages[0]?.title ?? ''}, Fassung 1`,
      ),
    ).toBeTruthy()

    const check = screen.getByRole('list', { name: 'Prüfen' })

    expect(
      within(within(check).getByRole('group', { name: 'Sicherheitsventil löst aus' }))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['In Ordnung', 'Nicht in Ordnung', 'Entfällt', 'Nicht möglich'])
    expect(
      within(check).getByRole('textbox', { name: /^Temperatur am Speicheraustritt in / }),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Angaben' })).getByRole('textbox', {
        name: 'Eingestellte Temperatur',
      }),
    ).toBeTruthy()
    // A point in order asks for nothing more in the list.
    expect(screen.queryByRole('textbox', { name: /^Bemerkung/ })).toBeNull()
  })

  it('begins the inspection with its first answer, on the day of the device, once', async () => {
    const { server } = await mountSite(`/vorgaenge/${inspection.id}`, {
      server: workServer(),
      ...withTheForm,
    })
    const valve = await screen.findByRole('group', { name: 'Sicherheitsventil löst aus' })

    fireEvent.click(within(valve).getByRole('button', { name: 'In Ordnung' }))
    await waitFor(() => {
      expect(queued(server)).toHaveLength(2)
    })
    fireEvent.click(within(valve).getByRole('button', { name: 'Nicht in Ordnung' }))
    await waitFor(() => {
      expect(queued(server)).toHaveLength(3)
    })

    expect(queued(server).map(({ entity, kind, values }) => [entity, kind, values])).toEqual([
      ['activities', 'update', { status: 'started', performedOn: today() }],
      [
        'activity_answers',
        'create',
        { activityId: inspection.id, fieldKey: 'valve', result: 'ok' },
      ],
      ['activity_answers', 'update', { result: 'not_ok' }],
    ])
    // Not in order, the point asks for its remark and says what the signature makes of it.
    expect(screen.getByRole('textbox', { name: 'Bemerkung, verlangt' })).toBeTruthy()
    expect(
      screen.getByText(
        'Wird mit der Unterschrift ein Mangel an AN-00057 Aufzug Heizraum. Klasse und Frist setzt, wer Mängel führt.',
      ),
    ).toBeTruthy()
  })
})

describe('the result and the signature on site', () => {
  it('names the points still without an answer, each leading to it, and is not signed before', async () => {
    await mountSite(result(inspection.id), { server: workServer(), ...withTheForm })

    const missing = await screen.findByRole('list', { name: 'Noch ohne Antwort:' })

    expect(
      within(missing)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      `/m/vorgaenge/${inspection.id}/punkte/valve`,
      `/m/vorgaenge/${inspection.id}/punkte/outlet`,
    ])

    choose('Mit Mängeln')
    draw()

    expect(signButton().disabled).toBe(true)
  })

  it('is not "ohne Mangel" while the protocol holds a defect, and is signed with defects', async () => {
    await mountSite(result(inspection.id), {
      server: answered({ result: 'not_ok', remark: 'Ventil klemmt.' }),
      ...withTheForm,
    })

    expect(
      await screen.findByText('Nicht, solange das Protokoll einen Mangel festhält.'),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Mängel' })).getByText(
        'Nicht in Ordnung, wird mit der Unterschrift ein Mangel',
      ),
    ).toBeTruthy()

    draw()
    choose('Ohne Mangel')

    expect(
      screen.getByText('Ein Vorgang, der einen Mangel festhält, ist nicht „ohne Mangel“.'),
    ).toBeTruthy()
    expect(signButton().disabled).toBe(true)

    choose('Mit Mängeln')

    expect(signButton().disabled).toBe(false)
  })

  it('signs without a network for the page the device holds, with the result, the remark and a defect reported in it', async () => {
    const server = answered()

    server.put('defects', {
      id: 'd-found',
      ...atTheSchool,
      assetId: heater.id,
      roomId: null,
      buildingId: null,
      description: 'Ventil tropft',
      defectClass: null,
      foundOn: '2026-10-09',
      foundInActivityId: inspection.id,
      foundInAnswerId: null,
      status: 'found',
      dueOn: null,
    })

    const { client, router } = await mountSite(result(inspection.id), { server, ...withTheForm })

    await screen.findByRole('group', { name: 'Ergebnis' })
    goOffline(server)
    choose('Mit Mängeln')

    const remark = screen.getByRole('textbox', { name: 'Bemerkung' })

    fireEvent.change(remark, { target: { value: ' Ventil nachgezogen. ' } })
    fireEvent.blur(remark)
    draw()
    await waitFor(() => {
      expect(signButton().disabled).toBe(false)
    })
    fireEvent.click(signButton())

    expect(await screen.findByText('Unterschrieben')).toBeTruthy()
    expect(screen.getByText(/wartet auf die Übertragung$/)).toBeTruthy()

    // The page as the server works it out from the same rows, by hand.
    const page = signedPageOf({
      activity: {
        id: inspection.id,
        kind: 'inspection',
        title: inspection.title,
        performedOn: today(),
      },
      place: {
        property: {
          name: school.name,
          address: `${school.street}, ${school.postalCode} ${school.city}`,
        },
        building: { name: house.name, shortCode: house.shortCode },
        room: { number: boilerRoom.number, name: boilerRoom.name },
        asset: {
          id: heater.id,
          name: heater.name,
          kind: heater.kind,
          serialNumber: heater.serialNumber,
        },
      },
      duties: [
        {
          dutyId: heaterDuty.id,
          kind: null,
          label: heaterDuty.label,
          result: 'with_defects',
          resultReason: null,
          remark: 'Ventil nachgezogen.',
        },
      ],
      defects: [{ id: 'd-found', description: 'Ventil tropft', defectClass: null }],
      form: { key: 'probe.heater_check', version: 1 },
      answers: [answerOf('outlet', { value: '65000' }), answerOf('valve', { result: 'ok' })],
    })
    const fingerprint = createHash('sha256').update(canonicalForm(page), 'utf8').digest('hex')

    expect(heldFor(client, 'activity_signatures')).toMatchObject([
      { role: 'signer', path: 'M100,300L240,120L400,280', pageFingerprint: fingerprint },
    ])

    goOnline(server)
    await waitFor(() => {
      expect(queued(server).map(({ entity }) => entity)).toEqual([
        'activities',
        'activity_duties',
        'activity_duties',
        'activity_signatures',
      ])
    })

    expect(queued(server).slice(0, 3)).toEqual([
      {
        entity: 'activities',
        kind: 'update',
        values: { status: 'started', performedOn: today() },
      },
      {
        entity: 'activity_duties',
        kind: 'update',
        values: { result: 'with_defects' },
      },
      { entity: 'activity_duties', kind: 'update', values: { remark: 'Ventil nachgezogen.' } },
    ])
    // Signed, nothing here changes any more, and the protocol takes no answer.
    expect(await screen.findByText(/übertragen$/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Ergebnis' })).toBeNull()

    await router.navigate({ to: `/vorgaenge/${inspection.id}` })

    const valve = await screen.findByRole('group', { name: 'Sicherheitsventil löst aus' })

    expect(
      within(valve)
        .getAllByRole<HTMLButtonElement>('button')
        .every((button) => button.disabled),
    ).toBe(true)
  })

  it('has nothing but its result for an activity without a form, with a remark', async () => {
    const { server } = await mountSite(`/vorgaenge/${maintenance.id}`, {
      server: workServer(),
      ...withTheForm,
    })

    await screen.findByRole('group', { name: 'Ergebnis' })
    expect(screen.queryByRole('list', { name: 'Noch ohne Antwort:' })).toBeNull()

    choose('Ohne Mangel')

    const remark = screen.getByRole('textbox', { name: 'Bemerkung' })

    fireEvent.change(remark, { target: { value: 'Filter gespült.' } })
    fireEvent.blur(remark)
    await waitFor(() => {
      expect(queued(server)).toHaveLength(3)
    })

    expect(queued(server)).toEqual([
      {
        entity: 'activities',
        kind: 'update',
        values: { status: 'started', performedOn: today() },
      },
      {
        entity: 'activity_duties',
        kind: 'update',
        values: { result: 'without_defects' },
      },
      { entity: 'activity_duties', kind: 'update', values: { remark: 'Filter gespült.' } },
    ])
  })

  it('writes "nicht durchgeführt" only with its reason, and signs it only then', async () => {
    const { server } = await mountSite(result(maintenance.id), {
      server: workServer(),
      ...withTheForm,
    })

    await screen.findByRole('group', { name: 'Ergebnis' })
    choose('Nicht durchgeführt')
    draw()

    expect(signButton().disabled).toBe(true)

    const reason = screen.getByRole('textbox', { name: /^Warum nicht durchgeführt/ })

    fireEvent.change(reason, { target: { value: 'Anlage abgeschaltet.' } })
    fireEvent.blur(reason)
    await waitFor(() => {
      expect(queued(server).map(({ entity }) => entity)).toEqual(['activities', 'activity_duties'])
    })

    expect(queued(server)[1]?.values).toEqual({
      result: 'not_performed',
      resultReason: 'Anlage abgeschaltet.',
    })
    expect(signButton().disabled).toBe(false)
  })

  it('reports a defect found in the activity, on its day, and comes back to the result', async () => {
    const server = workServer()

    server.put('activities', { ...maintenance, status: 'started', performedOn: '2026-10-08' })
    await mountSite(result(maintenance.id), { server, ...withTheForm })

    fireEvent.click(await screen.findByRole('button', { name: 'Mangel hinzufügen' }))
    await screen.findByRole('heading', { name: 'Mangel melden' })
    fireEvent.change(screen.getByRole('textbox', { name: /^Bemerkung/ }), {
      target: { value: 'Dichtung porös' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    const defects = await screen.findByRole('list', { name: 'Mängel' })

    expect(within(defects).getByText('Dichtung porös')).toBeTruthy()
    await waitFor(() => {
      expect(queued(server).map(({ entity }) => entity)).toEqual(['defects'])
    })
    expect(queued(server)[0]?.values).toMatchObject({
      description: 'Dichtung porös',
      foundOn: '2026-10-08',
      foundInActivityId: maintenance.id,
      assetId: heater.id,
    })
  })
})

describe('a defect in an activity that is signed or closed', () => {
  it('is not reported in it, and the screen says where it is reported instead', async () => {
    const server = workServer()

    server.put('activities', { ...maintenance, status: 'done', performedOn: '2026-10-08' })
    await mountSite(`/vorgaenge/${maintenance.id}/mangel`, { server, ...withTheForm })

    expect(
      await screen.findByText(
        'Dieser Vorgang ist unterschrieben oder abgeschlossen. Ein Mangel wird jetzt an der Anlage oder am Raum gemeldet.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Melden' })).toBeNull()
  })
})

describe('a signature the server did not take', () => {
  const at = new Date('2026-10-09T07:30:00Z')

  function refused(part: Partial<SyncConflict>): SyncConflict {
    return {
      id: 'k-signature',
      tenantId: 't-nord',
      operationId: 'op-signature',
      entity: 'activity_signatures',
      recordId: 's-1',
      reason: 'record_is_fixed',
      fields: ['activityId'],
      wanted: { activityId: inspection.id, role: 'signer' },
      seen: {},
      found: {},
      deviceId: 'phone',
      recordedAt: at,
      resolvedAt: null,
      createdAt: at,
      updatedAt: at,
      ...part,
    } as SyncConflict
  }

  /** The conflicts on site, with one about a signature, and what was closed. */
  async function deciding(conflict: SyncConflict, activity: Readonly<Record<string, unknown>>) {
    const closed: string[] = []
    let waiting = [conflict]
    const server = Object.assign(workServer(), {
      conflicts: () => Promise.resolve(waiting),
      resolve: (id: string) => {
        closed.push(id)
        waiting = waiting.filter((each) => each.id !== id)

        return Promise.resolve()
      },
    })

    server.put('activities', activity)

    const site = await mountSite('/konflikte', { server, ...withTheForm })

    return { ...site, closed }
  }

  it('says that the office closed the activity, with its reason, and is taken note of', async () => {
    const { closed } = await deciding(refused({}), {
      ...inspection,
      status: 'not_performed',
      closingReason: 'Anlage außer Betrieb.',
    })

    expect(
      await screen.findByText(
        'Das Büro hat diesen Vorgang geschlossen, bevor das Gerät übertragen hat. Die Unterschrift wurde nicht angenommen.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Grund im Büro: Anlage außer Betrieb.')).toBeTruthy()
    expect(screen.getByText('Prüfung des Speichers')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Zur Kenntnis genommen' }))

    await waitFor(() => {
      expect(closed).toEqual(['k-signature'])
    })
  })

  it('leads to signing again where the page changed since', async () => {
    const { closed, router } = await deciding(
      refused({ reason: 'changed_elsewhere', fields: ['pageFingerprint'] }),
      { ...inspection, status: 'started', performedOn: '2026-10-09' },
    )

    expect(
      await screen.findByText(
        'Die Seite hat sich geändert, seit sie unterschrieben wurde. Sie wird neu gezeigt und neu unterschrieben.',
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Neu unterschreiben' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${inspection.id}/ergebnis`)
    })
    expect(closed).toEqual(['k-signature'])
  })
})
