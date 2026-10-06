import {
  type AssetRegisterFilter,
  type LabelFormat,
  labelReadingOf,
  type LabelStandingAnswer,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  maybeText,
  request,
  RequestRefused,
  text,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
  workingInHeaders,
} from '@opengewerk/platform-web/sync'
import { useEffect, useState } from 'react'

/**
 * The labels with a QR code on assets and rooms (#98, section 3 of the
 * concept), as both entries need them: the office makes, prints and blocks
 * them, and a scan on site or the address of a label in the browser finds
 * what a code opens. The rows come through the sync; making, blocking and
 * printing go to the routes of the server, which draws the code.
 */

/** What a label hangs on, as the routes of the server name it. */
export type LabelHolder = 'assets' | 'rooms'

const holderFields = { assets: 'assetId', rooms: 'roomId' } as const

function blockedAtOf(label: RecordState): string | null {
  return maybeText(label, 'blockedAt')
}

/**
 * The labels of one asset or room: the valid one, if there is one, and the
 * one blocked last, which the card names as long as there is no valid one.
 */
export function useLabelsOf(
  holder: LabelHolder,
  id: string,
): { readonly valid: RecordState | null; readonly lastBlocked: RecordState | null } {
  const labels = useRelated('labels', holderFields[holder], id)
  const valid = labels.find((label) => blockedAtOf(label) === null) ?? null
  const blocked = labels
    .filter((label) => blockedAtOf(label) !== null)
    .sort((a, b) => String(blockedAtOf(b)).localeCompare(String(blockedAtOf(a))))

  return { valid, lastBlocked: blocked[0] ?? null }
}

const base = (holder: LabelHolder, id: string) => `/${holder}/${encodeURIComponent(id)}/labels`

/** A new label for the asset or the room; the server draws the code. */
export function makeLabel(holder: LabelHolder, id: string): Promise<{ readonly id: string }> {
  return request(base(holder, id), { method: 'POST' })
}

/** Blocks a label for good. */
export function blockLabel(holder: LabelHolder, id: string, labelId: string): Promise<unknown> {
  return request(`${base(holder, id)}/${encodeURIComponent(labelId)}/block`, { method: 'POST' })
}

/** The address of the PDF of one label, for a link that opens it. */
export function labelPdfAddress(
  holder: LabelHolder,
  id: string,
  labelId: string,
  format: LabelFormat,
  count: number,
  start: number,
): string {
  const query = new URLSearchParams({ format, count: String(count) })

  if (format === 'sheet') {
    query.set('start', String(start))
  }

  return `${base(holder, id)}/${encodeURIComponent(labelId)}/pdf?${query.toString()}`
}

/** What a print of many labels is asked for: which labels, and on what. */
export type LabelBatch =
  | { readonly what: 'assets'; readonly filter: AssetRegisterFilter }
  | { readonly what: 'rooms'; readonly buildingId: string }
  | { readonly what: 'blank'; readonly propertyId: string; readonly count: number }

/**
 * A print of many different labels, as a PDF: the server makes the labels
 * that are missing and answers with the page. Not a link like the PDF of one
 * label: a link asks with GET, and a request that makes something is none.
 */
export async function printLabels(
  batch: LabelBatch,
  format: LabelFormat,
  start: number,
): Promise<Blob> {
  const { what, ...named } = batch
  const response = await fetch(`/labels/print/${what}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/pdf, application/json',
      'Content-Type': 'application/json',
      ...workingInHeaders(),
    },
    body: JSON.stringify({ ...named, format, ...(format === 'sheet' ? { start } : {}) }),
  })

  if (!response.ok) {
    const answer = (await response.json().catch(() => null)) as { message?: unknown } | null
    const message =
      typeof answer?.message === 'string' ? answer.message : 'Der Druck ist nicht gelungen.'

    throw new RequestRefused(response.status, message, answer)
  }

  return response.blob()
}

/**
 * Where the office shows what a label opens. Written here and not taken from
 * the office: the entry on site leads there with a plain link, and loads
 * nothing of the office for it. A test of the office holds the two together.
 */
export const labelOpens = {
  asset: (id: string) => `/anlagen/${id}`,
  room: (id: string) => `/raeume/${id}`,
} as const

/**
 * What a code opens for the person on this device, the answer the scanner on
 * site and the address in the browser give alike.
 *
 * - `waiting` while the device or the server is still being asked.
 * - `asset` and `room`: a valid label, with what it hangs on.
 * - `blocked`: it opens nothing any more, for whoever asks.
 * - `unassigned`: a label from a sheet that hangs on no asset yet.
 * - `outside`: a label of the operator outside the areas of the person.
 * - `unknown`: no label of this operator.
 * - `notHere`: the device holds no label with the code and cannot ask.
 */
export type LabelLookup =
  | { readonly state: 'waiting' }
  | { readonly state: 'asset'; readonly assetId: string }
  | { readonly state: 'room'; readonly roomId: string }
  | { readonly state: 'blocked' }
  | { readonly state: 'unassigned' }
  | { readonly state: 'outside' }
  | { readonly state: 'unknown' }
  | { readonly state: 'notHere' }

/** What the server said about a code, or that it could not be asked. */
type Asked = LabelStandingAnswer['standing'] | 'unreachable' | 'fetched'

/**
 * Asks the rows on the device first: a label it holds is answered at once,
 * also without a network. A code it does not hold is asked of the server,
 * which says in one word what it is; for a label the person sees, the device
 * fetches it with one exchange and answers from its rows then.
 */
export function useLabelLookup(code: string): LabelLookup {
  const client = useSync()
  const { online } = useSyncStatus()
  const labels = useRecords('labels')
  const held = labels.find((label) => text(label, 'code') === code) ?? null
  const [asked, setAsked] = useState<{ readonly code: string; readonly said: Asked } | null>(null)
  const said = asked?.code === code ? asked.said : null

  useEffect(() => {
    if (held !== null || !online || said !== null) {
      return
    }

    let current = true
    const answer = (next: Asked) => {
      if (current) {
        setAsked({ code, said: next })
      }
    }

    void request<LabelStandingAnswer>(`/labels/${encodeURIComponent(code)}`)
      .then(async ({ standing }) => {
        if (standing === 'open') {
          await client.synchronise()
          answer('fetched')
        } else {
          answer(standing)
        }
      })
      .catch(() => {
        answer('unreachable')
      })

    return () => {
      current = false
    }
  }, [client, code, held, online, said])

  if (held !== null) {
    return labelReadingOf(held)
  }

  if (said === 'blocked' || said === 'outside' || said === 'unknown') {
    return { state: said }
  }

  // Asked and answered, and the device still holds nothing: it could not
  // fetch the label, or could not ask at all.
  if (said === 'fetched' || said === 'unreachable' || said === 'open' || !online) {
    return { state: 'notHere' }
  }

  return { state: 'waiting' }
}

/** A message about a code that opens nothing: a title and what it means. */
export interface LabelMessage {
  readonly title: string
  readonly text: string
}

/**
 * The words for a code that opens nothing, the same on site and in the
 * office (board "Etikett gesperrt, fremd, außerhalb"). None of them names
 * anything about what the label hangs on.
 */
export const labelMessages = {
  blocked: {
    title: 'Etikett gesperrt',
    text: 'Dieses Etikett ist gesperrt und öffnet nichts mehr. Ein neues gibt es im Büro.',
  },
  unknown: {
    title: 'Kein Etikett dieses Betreibers',
    text: 'Dieses Etikett gehört nicht zu diesem Betreiber. Es öffnet hier nichts.',
  },
  outside: {
    title: 'Außerhalb Ihrer Bereiche',
    text: 'Was dieses Etikett öffnet, liegt nicht in Ihren Bereichen. Wer dort zuständig ist, sieht es.',
  },
  unassigned: {
    title: 'Noch keiner Anlage zugeordnet',
    text: 'Dieses Etikett stammt von einem Bogen für die Bestandsaufnahme und hängt noch an keiner Anlage.',
  },
  notHere: {
    title: 'Nicht auf diesem Gerät',
    text: 'Dieses Gerät hält kein Etikett mit diesem Code. Mit Verbindung beantwortet der Server, was es öffnet.',
  },
  foreign: {
    title: 'Kein Etikett',
    text: 'Der Code gehört zu keinem Etikett dieser Anwendung.',
  },
} as const satisfies Readonly<Record<string, LabelMessage>>

/** The message of a lookup that opens nothing, or null for one that opens something or waits. */
export function messageOf(lookup: LabelLookup): LabelMessage | null {
  switch (lookup.state) {
    case 'blocked':
    case 'unknown':
    case 'outside':
    case 'unassigned':
    case 'notHere':
      return labelMessages[lookup.state]
    default:
      return null
  }
}
