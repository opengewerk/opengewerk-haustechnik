import { createHash } from 'node:crypto'

import { canonicalForm } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { pageOnDevice } from '../../app/signing.js'
import { servingCatalogue } from '../../app/test-catalogue.js'
import { formCatalogue, heaterDuty, inspection, lineOf, workServer } from '../test-form.js'
import {
  afterEachSiteTest,
  goOffline,
  heater,
  house,
  mountSite,
  pump,
  queued,
  school,
} from '../test-site.js'

/**
 * A collective activity on site (#342, 4.4 of the concept): the list of its
 * assets with their results, the result of one asset without a signature,
 * and the one signature under a page that names every asset with its
 * result, all of it also without a network.
 */

afterEach(afterEachSiteTest)

const withTheForm = { answers: servingCatalogue(formCatalogue) }
const atTheSchool = { propertyId: school.id, areaId: school.areaId }

const collective = {
  ...inspection,
  id: 'ac-col',
  assetId: null,
  buildingId: house.id,
  title: 'Prüfung der Speicher, Schulhaus',
  formKey: null,
  formVersion: null,
  collectiveKind: 'probe.heater_test',
  collectiveId: null,
}
const atTheHeater = { ...inspection, id: 'ac-heater', collectiveId: collective.id }
const atThePump = { ...inspection, id: 'ac-pump', assetId: pump.id, collectiveId: collective.id }
const pumpDuty = { ...heaterDuty, id: 'du-pump', assetId: pump.id }

/**
 * The school with the collective activity of the heater and the pump: the
 * heater has its result, the pump has the one given, or none.
 */
function collectiveServer(
  pumpResult: { result: string; resultReason: string | null } | null = null,
) {
  const server = workServer()

  server.put('duties', pumpDuty)
  server.put('activities', collective)
  server.put('activities', { ...atTheHeater, status: 'started', performedOn: '2026-10-09' })
  server.put('activities', atThePump)
  server.put('activity_duties', { ...lineOf(atTheHeater.id), result: 'without_defects' })
  server.put('activity_duties', {
    ...lineOf(atThePump.id),
    dutyId: pumpDuty.id,
    ...(pumpResult ?? {}),
  })

  return server
}

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

describe('a collective activity on site', () => {
  it('lists its assets with their results, and leads to the signature once every asset has one', async () => {
    await mountSite(`/vorgaenge/${collective.id}`, { server: collectiveServer(), ...withTheForm })

    const list = await screen.findByRole('list', { name: 'Anlagen' })

    expect(
      within(list)
        .getAllByRole('link')
        .map((row) => [row.textContent, row.getAttribute('href')]),
    ).toEqual([
      ['AN-00057 Aufzug HeizraumErdgeschoss, E.14 HeizraumOhne Mangel', '/m/vorgaenge/ac-heater'],
      ['AN-00059 ZirkulationspumpeErdgeschoss, E.14 Heizraumoffen', '/m/vorgaenge/ac-pump'],
    ])
    expect(screen.getByText('1 von 2 mit Ergebnis')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Weiter zur Unterschrift' }).disabled,
    ).toBe(true)
    expect(
      screen.getByText('Unterschrieben wird, wenn jede Anlage ein Ergebnis hat. Noch 1 ohne.'),
    ).toBeTruthy()
  })

  it('counts an asset that could not be reached, not performed with its reason, as one with a result', async () => {
    await mountSite(`/vorgaenge/${collective.id}`, {
      server: collectiveServer({ result: 'not_performed', resultReason: 'Raum verschlossen' }),
      ...withTheForm,
    })

    await screen.findByText('2 von 2 mit Ergebnis')

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Weiter zur Unterschrift' }).disabled,
    ).toBe(false)
  })
})

describe('the result of an asset of a collective activity', () => {
  it('is given without a signature and asks no answer of an asset that could not be reached', async () => {
    const server = collectiveServer()

    await mountSite(`/vorgaenge/${atThePump.id}/ergebnis`, { server, ...withTheForm })
    await screen.findByRole('group', { name: 'Ergebnis' })

    expect(screen.queryByRole('button', { name: 'Unterschreiben' })).toBeNull()
    expect(screen.queryByRole('img', { name: 'Feld für die Unterschrift' })).toBeNull()
    expect(
      screen.getByText('Unterschrieben wird einmal für alle Anlagen, unter der Liste.'),
    ).toBeTruthy()
    // Its protocol is still to be answered …
    expect(screen.getByText('Noch ohne Antwort:')).toBeTruthy()

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Ergebnis' })).getByRole('radio', {
        name: 'Nicht durchgeführt',
      }),
    )

    const reason = screen.getByRole('textbox', { name: /^Warum nicht durchgeführt/ })

    fireEvent.change(reason, { target: { value: 'Raum verschlossen' } })
    fireEvent.blur(reason)

    // … and not any more for an asset that could not be reached.
    await waitFor(() => {
      expect(screen.queryByText('Noch ohne Antwort:')).toBeNull()
    })
    await waitFor(() => {
      expect(queued(server)).toEqual(
        expect.arrayContaining([
          {
            entity: 'activities',
            kind: 'update',
            values: expect.objectContaining({ status: 'started' }),
          },
          {
            entity: 'activity_duties',
            kind: 'update',
            values: { result: 'not_performed', resultReason: 'Raum verschlossen' },
          },
        ]),
      )
    })
    // The first input begins the part, and its collective activity with it.
    expect(
      server
        .operations()
        .filter((operation) => operation.entity === 'activities')
        .map((operation) => operation.recordId)
        .sort(),
    ).toEqual([atThePump.id, collective.id].sort())

    fireEvent.click(screen.getByRole('button', { name: 'Zur Liste' }))
    await screen.findByRole('list', { name: 'Anlagen' })
  })
})

describe('the one signature', () => {
  it('signs once, for the page of every asset, also without a network', async () => {
    const server = collectiveServer({ result: 'not_performed', resultReason: 'Raum verschlossen' })
    const { client } = await mountSite(`/vorgaenge/${collective.id}/unterschrift`, {
      server,
      ...withTheForm,
    })

    const named = await screen.findByRole('list', { name: 'Was Sie unterschreiben' })

    expect(
      within(named)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'AN-00057 Aufzug HeizraumErdgeschoss, E.14 HeizraumOhne Mangel',
      'AN-00059 ZirkulationspumpeErdgeschoss, E.14 HeizraumNicht durchgeführt',
    ])
    expect(screen.getByText('2 Nachweise, einer je Pflicht.')).toBeTruthy()
    expect(
      screen.getByText(
        'Nicht durchgeführt: AN-00059 Zirkulationspumpe. Ihr Termin bleibt, wie er ist.',
      ),
    ).toBeTruthy()

    goOffline(server)
    draw()

    const sign = screen.getByRole<HTMLButtonElement>('button', { name: 'Unterschreiben' })

    await waitFor(() => {
      expect(sign.disabled).toBe(false)
    })
    fireEvent.click(sign)

    expect(await screen.findByText('Unterschrieben')).toBeTruthy()

    // The page holds the page of each part, and the signature is for it.
    const page = pageOnDevice(client, collective.id)

    expect(page?.parts?.map((part) => [part.activity.id, part.place.asset?.id])).toEqual([
      [atTheHeater.id, heater.id],
      [atThePump.id, pump.id],
    ])
    expect(
      client.list('activity_signatures').filter((each) => each['activityId'] === collective.id),
    ).toMatchObject([
      {
        role: 'signer',
        pageFingerprint: createHash('sha256').update(canonicalForm(page), 'utf8').digest('hex'),
      },
    ])
    expect(atTheSchool.propertyId).toBe(school.id)
  })
})
