import { fromTheGallery } from '@opengewerk/platform-web/forms'
import { today } from '@opengewerk/platform-web/format'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { afterEachSiteTest, goOffline, goOnline, mountSite, queued } from '../test-site.js'
import { reportDefectWords } from './report-defect.js'

/**
 * "Mangel melden" on site (#116, 4.6 of the concept): at the asset or the
 * room whose page leads there, with a remark and photos, into the outbox and
 * so also without a network; a class and a deadline are nothing a device
 * sends.
 */

afterEach(afterEachSiteTest)

const reporting = ['asset.read', 'room.read', 'defect.read', 'defect.report']

describe('a defect reported on site', () => {
  it('goes into the outbox at its asset with the remark and the day, without a class', async () => {
    const { server, router } = await mountSite('/anlagen/a-heater/mangel', { rights: reporting })

    fireEvent.change(await screen.findByLabelText(/Bemerkung/), {
      target: { value: 'Kondensat tropft am Abgasrohr' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    await waitFor(() => {
      expect(queued(server)).toHaveLength(1)
    })

    const [made] = queued(server)

    expect(made).toMatchObject({ entity: 'defects', kind: 'create' })
    expect(made?.values).toEqual({
      description: 'Kondensat tropft am Abgasrohr',
      foundOn: today(),
      propertyId: 'p-school',
      assetId: 'a-heater',
    })
    expect(made?.values).not.toHaveProperty('defectClass')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-heater')
    })
  })

  it('files the photos from the camera and the gallery at the defect, there several at once', async () => {
    const { server } = await mountSite('/anlagen/a-heater/mangel', { rights: reporting })

    fireEvent.change(await screen.findByLabelText(/Bemerkung/), {
      target: { value: 'Kondensat tropft am Abgasrohr' },
    })
    fireEvent.change(screen.getByLabelText(reportDefectWords.photoField), {
      target: { files: [new File(['eins'], 'abgasrohr.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.change(screen.getByLabelText(fromTheGallery(reportDefectWords.photoField)), {
      target: {
        files: [
          new File(['zwei'], 'boden.jpg', { type: 'image/jpeg' }),
          new File(['drei'], 'kessel.jpg', { type: 'image/jpeg' }),
        ],
      },
    })
    expect(screen.getByText('kessel.jpg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    await waitFor(() => {
      expect(queued(server).filter((each) => each.entity === 'attachments')).toHaveLength(3)
    })

    const defectId = server.operations()[0]?.recordId

    expect(
      queued(server)
        .filter((each) => each.entity === 'attachments')
        .map((each) => [each.values['title'], each.values['defectId']]),
    ).toEqual([
      ['abgasrohr', defectId],
      ['boden', defectId],
      ['kessel', defectId],
    ])
  })

  it('waits on the device without a network and goes with the next exchange', async () => {
    const { server } = await mountSite('/raeume/r-boiler/mangel', { rights: reporting })

    goOffline(server)
    fireEvent.change(await screen.findByLabelText(/Bemerkung/), {
      target: { value: 'Fenster schließt nicht' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    expect(await screen.findByText('1 Änderung auf dem Gerät.')).toBeTruthy()
    expect(queued(server)).toEqual([])

    goOnline(server)

    await waitFor(() => {
      expect(queued(server)).toHaveLength(1)
    })
  })

  it('reports one at a room as well', async () => {
    const { server } = await mountSite('/raeume/r-boiler/mangel', { rights: reporting })

    fireEvent.change(await screen.findByLabelText(/Bemerkung/), {
      target: { value: 'Fenster schließt nicht' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    await waitFor(() => {
      expect(queued(server)[0]?.values).toMatchObject({ roomId: 'r-boiler' })
    })
    expect(queued(server)[0]?.values).not.toHaveProperty('assetId')
  })

  it('queues nothing without a remark, and says so', async () => {
    const { server, router } = await mountSite('/anlagen/a-heater/mangel', { rights: reporting })

    fireEvent.click(await screen.findByRole('button', { name: 'Melden' }))

    expect(await screen.findByText('Die Beschreibung fehlt.')).toBeTruthy()
    expect(await screen.findByText(reportDefectWords.check)).toBeTruthy()
    expect(router.state.location.pathname).toBe('/anlagen/a-heater/mangel')
    expect(queued(server)).toEqual([])
  })

  it('is offered on the page of an asset and of a room to whoever may report', async () => {
    const { router } = await mountSite('/anlagen/a-heater', {
      rights: [...reporting, 'duty.read'],
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Mangel melden' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-heater/mangel')
    })
  })

  it('is not offered to whoever may not report', async () => {
    await mountSite('/anlagen/a-heater', { rights: ['asset.read', 'defect.read'] })

    await screen.findByText('Aufzug Heizraum')

    expect(screen.queryByRole('button', { name: 'Mangel melden' })).toBeNull()
  })
})
