import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { formCatalogue, round } from '../test-form.js'
import {
  addressOf,
  afterEachSiteTest,
  board,
  heater,
  mountSite,
  onHeater,
  rod,
  schoolServer,
} from '../test-site.js'

/**
 * A round with a point for every asset of a kind on site (#343, the boards
 * "Rundgang: jede Anlage einer Art", "Rundgang: Punkt einer Anlage" and
 * "Rundgang: Etikett springt zur Anlage"): the point stands with each asset
 * the round was given, each answered on its own and written with its asset,
 * and the label of one of them, scanned in the round, opens its point.
 */

afterEach(afterEachSiteTest)

const template = '0192f0c4-7b4e-7000-8000-0000000000c3'
const label = 'Aufzug ohne Störung'

/** The round at the school, with the point for every elevator given the board and the heater, in this order. */
function serverWithTheRound() {
  const server = schoolServer()

  server.put('round_template_versions', {
    id: 'v-every',
    templateId: template,
    formVersion: 1,
    asksCountersignature: false,
    definition: JSON.stringify({
      title: 'Brandschutz Schulhaus',
      sections: [
        {
          key: 'k1',
          title: 'Aufzüge',
          fields: [
            { kind: 'check_point', key: 'p1', label, everyAssetOf: 'probe.elevator' },
            { kind: 'check_point', key: 'p2', label: 'Schacht frei' },
          ],
        },
      ],
    }),
  })
  server.put('activities', {
    ...round,
    formKey: `template-${template}`,
    formVersion: 1,
    pointAssets: JSON.stringify({ p1: [board.id, heater.id] }),
  })

  return server
}

const withTheForm = { answers: servingCatalogue(formCatalogue) }

/** The answers the device holds for the round, as entity rows. */
function answersOn(client: { list: (entity: string) => readonly Record<string, unknown>[] }) {
  return client.list('activity_answers').filter((answer) => answer['activityId'] === round.id)
}

describe('a point for every asset of a kind on site (#343)', () => {
  it('stands with each asset the round was given, in its order, and the scan beside them', async () => {
    await mountSite(`/vorgaenge/${round.id}`, { server: serverWithTheRound(), ...withTheForm })

    const point = (await screen.findByRole('heading', { name: label })).closest('div.border-b')

    expect(point).not.toBeNull()

    const rows = within(point as HTMLElement).getAllByRole('link')

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('AN-00041 Unterverteilung UV-EG'),
      expect.stringContaining('AN-00057 Aufzug Heizraum'),
    ])
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      `/m/vorgaenge/${round.id}/punkte/p1@${board.id}`,
      `/m/vorgaenge/${round.id}/punkte/p1@${heater.id}`,
    ])
    // The elevator the round was not given has no point in it.
    expect(screen.queryByText(new RegExp(rod.number))).toBeNull()
    expect(within(point as HTMLElement).getByText('0 von 2')).toBeDefined()
    expect(
      within(point as HTMLElement).getByRole('button', { name: 'Etikett scannen' }),
    ).toBeDefined()
  })

  it('writes the answer of one asset with that asset, and no other', async () => {
    const site = await mountSite(`/vorgaenge/${round.id}/punkte/p1@${heater.id}`, {
      server: serverWithTheRound(),
      ...withTheForm,
    })

    expect(await screen.findByText(/AN-00057 Aufzug Heizraum/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'In Ordnung' }))

    await waitFor(() => {
      expect(answersOn(site.client)).toEqual([
        expect.objectContaining({ fieldKey: 'p1', assetId: heater.id, result: 'ok' }),
      ])
    })
  })

  it('writes the answer of a second asset beside the one the first already has', async () => {
    const server = serverWithTheRound()

    server.put('activity_answers', {
      id: 'aa-board',
      propertyId: round.propertyId,
      areaId: round.areaId,
      activityId: round.id,
      groupKey: null,
      blockKey: null,
      fieldKey: 'p1',
      assetId: board.id,
      value: null,
      result: 'ok',
      remark: null,
      attachmentId: null,
    })

    const site = await mountSite(`/vorgaenge/${round.id}/punkte/p1@${heater.id}`, {
      server,
      ...withTheForm,
    })

    expect(await screen.findByText(/AN-00057 Aufzug Heizraum/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'In Ordnung' }))

    await waitFor(() => {
      expect(
        answersOn(site.client)
          .map((answer) => [answer['assetId'], answer['result']])
          .sort(),
      ).toEqual([
        [board.id, 'ok'],
        [heater.id, 'ok'],
      ])
    })
  })

  it('names each asset still without its answer at the handing in', async () => {
    const server = serverWithTheRound()

    server.put('activity_answers', {
      id: 'aa-board',
      propertyId: round.propertyId,
      areaId: round.areaId,
      activityId: round.id,
      groupKey: null,
      blockKey: null,
      fieldKey: 'p1',
      assetId: board.id,
      value: null,
      result: 'ok',
      remark: null,
      attachmentId: null,
    })
    await mountSite(`/vorgaenge/${round.id}/abgabe`, { server, ...withTheForm })

    const lacking = await screen.findByRole('list', { name: 'Noch ohne Antwort:' })

    expect(
      within(lacking)
        .getAllByRole('link')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining(`${label}, AN-00057 Aufzug Heizraum`),
      expect.stringContaining('Schacht frei'),
    ])
  })

  it('opens the point of the asset whose label is scanned in the round', async () => {
    const site = await mountSite(`/vorgaenge/${round.id}/scannen`, {
      server: serverWithTheRound(),
      ...withTheForm,
    })

    expect(await screen.findByText(/Etikett einer Anlage dieses Rundgangs/)).toBeDefined()

    site.hold(addressOf(onHeater.code))

    await waitFor(() => {
      expect(site.router.state.location.pathname).toBe(
        `/vorgaenge/${round.id}/punkte/p1@${heater.id}`,
      )
    })
  })

  it('says of the label of an asset the round has no point for that it opens nothing here', async () => {
    const server = serverWithTheRound()

    server.put('labels', { ...onHeater, id: 'l-rod', code: 'K9PDH4TA6W3XQ7M2', assetId: rod.id })

    const site = await mountSite(`/vorgaenge/${round.id}/scannen`, { server, ...withTheForm })

    await screen.findByText(/Etikett einer Anlage dieses Rundgangs/)
    site.hold(addressOf('K9PDH4TA6W3XQ7M2'))

    expect(await screen.findByText('Nicht in diesem Rundgang')).toBeDefined()
    expect(site.router.state.location.pathname).toBe(`/vorgaenge/${round.id}/scannen`)
  })
})
