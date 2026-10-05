import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeAt } from './made-at.js'

/**
 * A record made at its route (ADR 0006, point 6): what the route is sent,
 * that the exchange follows, and what a form is told when the route refuses
 * or nobody answers.
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
