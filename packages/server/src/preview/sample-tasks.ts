import { addDays } from '@opengewerk/haustechnik-domain'
import { newId } from '@opengewerk/platform-server'

import { dayInGermany } from '../today.js'
import { previewColleagues, previewPeople } from './preview-database.js'

/**
 * The sample tasks of the preview (#124): what the list "Aufgaben" and the
 * cards at a property, a building, a room and an asset show, as the board
 * "Aufgaben an Ort, Anlage und Vorgang (3)" draws them: three for whoever
 * looks, one of them due soon, and three with colleagues, one of them late.
 *
 * Written the way a device writes one, through the sync, as the Leitung that
 * plants the preview. Who looks at the preview may see only one area; a task
 * of theirs in the other is then refused by the server, as it would be for
 * anybody, and left out, and the others stand.
 */

/** A sample task: its text, how many days from today it is due, for whom, and where. */
interface SampleTask {
  readonly title: string
  readonly inDays: number
  readonly assigneeUserId: string
  /** The kind of record it hangs on and the name it is found by. */
  readonly at:
    | { readonly property: string }
    | { readonly property: string; readonly building: string }
    | { readonly property: string; readonly room: string }
    | { readonly property: string; readonly asset: string }
}

function colleague(name: string): string {
  const found = previewColleagues.find((each) => each.name === name)

  if (!found) {
    throw new Error(`In der Vorschau arbeitet niemand namens ${name}.`)
  }

  return found.id
}

const sampleTasks: readonly SampleTask[] = [
  {
    title: 'Schlüssel für den Heizraum beim Hausmeister hinterlegen',
    inDays: 2,
    assigneeUserId: previewPeople.viewer.id,
    at: { property: 'Schulzentrum Am Lindenhain', room: 'E.10' },
  },
  {
    title: 'Gefährdungsbeurteilung Werkstatt unterschreiben lassen',
    inDays: 5,
    assigneeUserId: previewPeople.viewer.id,
    at: { property: 'Werkhof Nord', building: 'Halle 1' },
  },
  {
    title: 'Wartungsvertrag des Aufzugs verlängern',
    inDays: 26,
    assigneeUserId: previewPeople.viewer.id,
    at: { property: 'Verwaltung Am Probehang', asset: 'Aufzug Haus A' },
  },
  {
    title: 'Fotos der Heizzentrale nachreichen',
    inDays: -2,
    assigneeUserId: colleague('Tobias Wendt'),
    at: { property: 'Schulzentrum Am Lindenhain', room: 'E.14' },
  },
  {
    title: 'Prüfplaketten nachbestellen',
    inDays: 4,
    assigneeUserId: colleague('Petra Lindner'),
    at: { property: 'Werkhof Nord' },
  },
  {
    title: 'Messgerät für die Isolationsmessung zur Kalibrierung geben',
    inDays: 12,
    assigneeUserId: colleague('Murat Yilmaz'),
    at: { property: 'Werkhof Nord', asset: 'Elektrische Anlage Halle 1' },
  },
]

type Row = Readonly<Record<string, unknown>>

/** Every row of the kinds a task hangs on, as the device of the Leitung holds them. */
async function heldRows(address: string): Promise<ReadonlyMap<string, readonly Row[]>> {
  const rows = new Map<string, Row[]>()
  let since = 0

  for (;;) {
    const response = await fetch(`${address}/sync?since=${String(since)}`)

    if (!response.ok) {
      throw new Error(`/sync lehnte ab (${String(response.status)}): ${await response.text()}`)
    }

    const answer = (await response.json()) as {
      readonly changes: readonly { readonly entity: string; readonly rows: readonly Row[] }[]
      readonly cursor: number
      readonly hasMore: boolean
    }

    for (const change of answer.changes) {
      rows.set(change.entity, [...(rows.get(change.entity) ?? []), ...change.rows])
    }

    if (!answer.hasMore) {
      return rows
    }

    since = answer.cursor
  }
}

/**
 * Plants the sample tasks through the routes of the preview at `address`,
 * each in a transmission of its own. A task the server keeps as a conflict is
 * left out; one it refuses stops the start with its answer.
 */
export async function plantSampleTasks(address: string): Promise<void> {
  const held = await heldRows(address)
  const named = (entity: string, field: string, value: string, propertyId: string) => {
    const found = (held.get(entity) ?? []).find(
      (row) => row[field] === value && row['propertyId'] === propertyId,
    )

    if (!found) {
      throw new Error(`In der Vorschau fehlt ${entity} ${value}.`)
    }

    return String(found['id'])
  }
  let recorded = Date.now()

  for (const task of sampleTasks) {
    const property = (held.get('properties') ?? []).find((row) => row['name'] === task.at.property)

    if (!property) {
      throw new Error(`In der Vorschau fehlt die Liegenschaft ${task.at.property}.`)
    }

    const propertyId = String(property['id'])
    const at = task.at
    const home =
      'building' in at
        ? { buildingId: named('buildings', 'name', at.building, propertyId) }
        : 'room' in at
          ? { roomId: named('rooms', 'number', at.room, propertyId) }
          : 'asset' in at
            ? { assetId: named('assets', 'name', at.asset, propertyId) }
            : {}
    const values = {
      title: task.title,
      dueOn: addDays(dayInGermany(), task.inDays),
      assigneeUserId: task.assigneeUserId,
      status: 'open',
      propertyId,
      ...home,
    }

    recorded += 1

    const response = await fetch(`${address}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'vorschau',
        operations: [
          {
            id: newId<'operation'>(),
            entity: 'tasks',
            recordId: newId<'task'>(),
            kind: 'create',
            baseVersion: null,
            patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
            recordedAt: new Date(recorded).toISOString(),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Die Beispielaufgabe „${task.title}“ lehnte der Server ab: ${await response.text()}`,
      )
    }
  }
}
