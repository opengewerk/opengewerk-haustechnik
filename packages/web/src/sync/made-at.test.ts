import { afterEach, describe, expect, it, vi } from 'vitest'

import { askAt, makeAt } from './made-at.js'

/**
 * A record made at its route (ADR 0006, point 6), and what a route is asked
 * to do to one that is there: what the route is sent, that the exchange
 * follows, and what a form is told when the route refuses or nobody answers.
 */

function answering(status: number, body: unknown) {
  const asked: { path: string; init: RequestInit | undefined }[] = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push({ path, init })

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  return asked
}

/** A sync client as far as it is asked here: it says when it exchanged. */
function exchanging() {
  const log: string[] = []

  return {
    log,
    client: {
      synchronise: () => {
        log.push('exchange')

        return Promise.resolve()
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a record made at its route', () => {
  it('is sent as it is, and the exchange brings it down before the answer is handed on', async () => {
    const asked = answering(201, { id: 'p-new', name: 'Campus' })
    const { client, log } = exchanging()

    const result = await makeAt(client, '/properties', { name: 'Campus', note: null })

    expect(result).toEqual({ outcome: 'queued', id: 'p-new' })
    expect(asked).toHaveLength(1)
    expect(asked[0]?.path).toBe('/properties')
    expect(asked[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(asked[0]?.init?.body))).toEqual({ name: 'Campus', note: null })
    expect(log).toEqual(['exchange'])
  })

  it('hands on the sentence of a refusal, and exchanges nothing', async () => {
    answering(400, { message: 'Die Postleitzahl hat fünf Ziffern.' })

    const { client, log } = exchanging()

    expect(await makeAt(client, '/properties', {})).toEqual({
      outcome: 'refused',
      reason: 'online_only',
      fields: [],
      message: 'Die Postleitzahl hat fünf Ziffern.',
    })
    expect(log).toEqual([])
  })

  it('says without a sentence that it takes a connection when nobody answers', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    const { client, log } = exchanging()

    // No message: the form then says in its own words that this takes a connection.
    expect(await makeAt(client, '/properties', {})).toEqual({
      outcome: 'refused',
      reason: 'online_only',
      fields: [],
    })
    expect(log).toEqual([])
  })

  it('lets the exchange notice a session that has run out', async () => {
    answering(401, { message: 'Nicht angemeldet.' })

    const { client, log } = exchanging()
    const result = await makeAt(client, '/properties', {})

    expect(result.outcome).toBe('refused')
    // The exchange is where the sign in is asked for again.
    expect(log).toEqual(['exchange'])
  })
})

describe('what a route is asked to do to a record that is there', () => {
  it('is sent with what it takes, and the answer names the record that was asked about', async () => {
    // The route answers with the room as it is now, which has an id of its own.
    const asked = answering(200, { id: 'r-1', floorId: 'f-2' })
    const { client, log } = exchanging()

    const result = await askAt(client, 'PUT', '/rooms/r-1/floor', 'r-1', { floorId: 'f-2' })

    expect(result).toEqual({ outcome: 'queued', id: 'r-1' })
    expect(asked).toHaveLength(1)
    expect(asked[0]?.path).toBe('/rooms/r-1/floor')
    expect(asked[0]?.init?.method).toBe('PUT')
    expect(JSON.parse(String(asked[0]?.init?.body))).toEqual({ floorId: 'f-2' })
    expect(log).toEqual(['exchange'])
  })

  it('is sent without a body where there is nothing to say, as a removal', async () => {
    const asked = answering(200, { id: 'c-9' })
    const { client, log } = exchanging()

    // Below a building: an address the sync client does not know. The answer
    // names the closure, whatever the route answered with.
    const result = await askAt(client, 'DELETE', '/buildings/b-1/closures/c-1', 'c-1')

    expect(result).toEqual({ outcome: 'queued', id: 'c-1' })
    expect(asked[0]?.path).toBe('/buildings/b-1/closures/c-1')
    expect(asked[0]?.init?.method).toBe('DELETE')
    expect(asked[0]?.init?.body).toBeUndefined()
    expect(log).toEqual(['exchange'])
  })

  it('hands on the sentence of a refusal, and exchanges nothing', async () => {
    const sentence =
      'In diesem Raum stehen Anlagen, gelöschte mitgezählt; er zieht deshalb nur innerhalb seines Gebäudes um.'

    answering(400, { message: sentence })

    const { client, log } = exchanging()

    expect(await askAt(client, 'PUT', '/rooms/r-1/floor', 'r-1', { floorId: 'f-9' })).toEqual({
      outcome: 'refused',
      reason: 'online_only',
      fields: [],
      message: sentence,
    })
    expect(log).toEqual([])
  })

  it('says without a sentence that it takes a connection when nobody answers', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    const { client, log } = exchanging()

    expect(await askAt(client, 'DELETE', '/rooms/r-1', 'r-1')).toEqual({
      outcome: 'refused',
      reason: 'online_only',
      fields: [],
    })
    expect(log).toEqual([])
  })
})
