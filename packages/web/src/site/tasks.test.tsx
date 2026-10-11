import { taskEntity } from '@opengewerk/haustechnik-domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  afterEachSiteTest,
  boilerRoom,
  goOffline,
  heater,
  mountSite,
  queued,
  schoolServer,
  school,
} from './test-site.js'

/**
 * The tasks on site (#124): "Meine Aufgaben" and the card at an asset, as
 * this application binds the row, the list and the form of the foundation.
 * What is held here: which tasks the list of the person shows, what a task
 * written in front of an asset hangs on, that it is written without a
 * network, and that nobody else is offered to whoever only writes tasks for
 * themselves.
 */

type Row = Record<string, unknown>

function task(id: string, over: Row): Row {
  return {
    id,
    title: 'Etwas',
    dueOn: '2099-01-10',
    assigneeUserId: 'u-1',
    status: 'open',
    propertyId: school.id,
    areaId: school.areaId,
    buildingId: null,
    roomId: null,
    assetId: null,
    activityId: null,
    createdBy: 'u-1',
    ...over,
  }
}

function server() {
  const at = schoolServer()

  at.put(
    taskEntity,
    task('t-room', { title: 'Fotos nachreichen', roomId: boilerRoom.id, dueOn: '2020-01-01' }),
  )
  at.put(taskEntity, task('t-asset', { title: 'Dichtung nachziehen', assetId: heater.id }))
  at.put(
    taskEntity,
    task('t-done', { title: 'Längst erledigt', status: 'done', assetId: heater.id }),
  )
  at.put(
    taskEntity,
    task('t-other', { title: 'Für jemand anderen', assigneeUserId: 'u-2', assetId: heater.id }),
  )

  return at
}

function rows(container: HTMLElement = document.body) {
  return within(container)
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
}

afterEach(afterEachSiteTest)

describe('"Meine Aufgaben"', () => {
  it('lists the open tasks of the person, the late one first, each with the record it hangs on', async () => {
    await mountSite('/aufgaben', { server: server() })

    await waitFor(() => {
      expect(rows()).toEqual([
        'Fotos nachreichenFällig am 01.01.2020, überfällig, verantwortlich: SieRaum E.14 Heizraum, SchulhausErledigt',
        'Dichtung nachziehenFällig am 10.01.2099, verantwortlich: SieAN-00057 Aufzug HeizraumErledigt',
      ])
    })
  })

  it('keeps a task ticked without a network in the list, saying it has not gone to the server', async () => {
    const site = await mountSite('/aufgaben', { server: server() })

    await screen.findByText('Dichtung nachziehen')
    goOffline(site.server)
    await userEvent.click(screen.getAllByRole('button', { name: 'Erledigt' })[1] as HTMLElement)

    await waitFor(() => {
      expect(rows()[1]).toContain('erledigt, noch nicht übertragen')
    })
    expect(queued(site.server)).toEqual([])
  })
})

describe('the tasks at an asset on site', () => {
  it('are those that hang on it, also of somebody else and done ones, which only their person changes', async () => {
    await mountSite(`/anlagen/${heater.id}`, { server: server() })
    const card = within(await screen.findByRole('region', { name: 'Aufgaben' }))

    await waitFor(() => {
      expect(card.queryAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Dichtung nachziehenFällig am 10.01.2099, verantwortlich: SieErledigt',
        'Für jemand anderenFällig am 10.01.2099, verantwortlich: jemand anderes',
        'Längst erledigtFällig am 10.01.2099, verantwortlich: Sie, erledigtWieder öffnen',
      ])
    })
  })

  it('takes a task for oneself without a network, at the asset and its property', async () => {
    const site = await mountSite(`/anlagen/${heater.id}`, { server: server() })
    const card = within(await screen.findByRole('region', { name: 'Aufgaben' }))

    goOffline(site.server)
    await userEvent.click(card.getByRole('button', { name: 'Aufgabe notieren' }))
    expect(
      Array.from((card.getByLabelText(/Verantwortlich/) as HTMLSelectElement).options).map(
        (option) => option.text,
      ),
    ).toEqual(['Pia Person (Sie)'])
    expect(
      card.getByText('Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.'),
    ).toBeTruthy()
    await userEvent.type(card.getByLabelText(/Was zu tun ist/), 'Thermometer mitbringen')
    await userEvent.click(card.getByRole('button', { name: 'Aufgabe anlegen' }))

    await waitFor(() => {
      expect(card.getByText('Thermometer mitbringen')).toBeTruthy()
    })
    expect(site.asked.some((each) => each.path === '/tasks/candidates')).toBe(false)

    site.server.offline = false
    await site.client.synchronise()

    expect(queued(site.server)).toEqual([
      {
        entity: taskEntity,
        kind: 'create',
        values: expect.objectContaining({
          title: 'Thermometer mitbringen',
          assigneeUserId: 'u-1',
          propertyId: school.id,
          assetId: heater.id,
        }) as unknown,
      },
    ])
  })
})
