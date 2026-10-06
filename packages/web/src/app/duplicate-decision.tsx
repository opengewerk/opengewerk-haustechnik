import {
  type DuplicateField,
  duplicateFields,
  labelAssignmentRefusal,
  possibleDuplicates,
  type RecordState,
  sameWords,
  type SyncConflict,
} from '@opengewerk/haustechnik-domain'
import { Button, type RecordWords, useEntry } from '@opengewerk/platform-web'
import {
  DecisionFrame,
  maybeText,
  refusalFor,
  text,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { makeAt } from '../sync/made-at.js'
import { titleOfRoom } from './place-records.js'

/**
 * The possible duplicate of an asset taken stock of on site, as the server
 * found it when the device exchanged (#99, sections 2.7 and 4.2 of the
 * concept): "die Person sieht die andere Anlage, soweit sie in ihrem Bereich
 * liegt, und entscheidet, ob es dieselbe ist oder ob sie trotzdem angelegt
 * wird". The card of this decision is this application's (`ownDecision`, ADR
 * 0010 in the repository opengewerk), in both entries, because the same
 * device may be opened in either.
 *
 * The asset was not made, so what was sent with it came back as conflicts of
 * its own: the photo of its type plate hangs on an asset that is not there,
 * and so does the label it was given. They are decided with the asset and
 * show no card. "Trotzdem anlegen" makes the asset at its route, with a
 * connection, and hangs both on it; "Ist dieselbe Anlage" hangs them on the
 * one that is there, so that the photo and the sticker of the same thing are
 * not lost; "Nicht anlegen" lets all of it go.
 */

/** The fields of an asset the route that makes one takes. */
const routeFields = [
  'kind',
  'name',
  'mark',
  'manufacturer',
  'model',
  'serialNumber',
  'yearBuilt',
  'commissionedOn',
  'warrantyEndsOn',
  'meterNumber',
  'meterUnit',
] as const

export const duplicateDecisionWords = {
  kind: 'Anlage',
  noName: 'Anlage ohne Bezeichnung',
  same: 'Ist dieselbe Anlage',
  anyway: 'Trotzdem anlegen',
  drop: 'Nicht anlegen',
  goesWith: 'Es geht mit der Entscheidung.',
  goWith: 'Sie gehen mit der Entscheidung.',
  notDecided: 'Die Entscheidung ließ sich nicht übertragen. Ohne Verbindung geht das nicht.',
} as const

/**
 * Whether a conflict is the possible duplicate of an asset that was to be
 * made: an asset the server holds nothing of, refused over its serial number
 * or its mark. A change to an asset names no building, so two devices that
 * corrected the same serial number are not taken for it.
 */
export function isDuplicateConflict(conflict: SyncConflict): boolean {
  return (
    conflict.entity === 'assets' &&
    conflict.reason === 'changed_elsewhere' &&
    Object.hasOwn(conflict.wanted, 'buildingId') &&
    conflict.fields.length > 0 &&
    conflict.fields.every((field) => (duplicateFields as readonly string[]).includes(field))
  )
}

/**
 * What came back with a possible duplicate because it hangs on the asset
 * that was not made: its documents with their versions, and its label.
 */
export function followersOf(
  duplicate: SyncConflict,
  conflicts: readonly SyncConflict[],
): readonly SyncConflict[] {
  const hung = conflicts.filter(
    (conflict) =>
      (conflict.entity === 'attachments' || conflict.entity === 'labels') &&
      conflict.reason === 'record_missing' &&
      conflict.wanted['assetId'] === duplicate.recordId,
  )
  const documents = new Set(
    hung.filter((conflict) => conflict.entity === 'attachments').map((each) => each.recordId),
  )

  return [
    ...hung,
    ...conflicts.filter(
      (conflict) =>
        conflict.entity === 'attachment_versions' &&
        conflict.reason === 'record_missing' &&
        documents.has(String(conflict.wanted['attachmentId'])),
    ),
  ]
}

/** The card of a possible duplicate, nothing for what is decided with one, and the foundation's for the rest. */
export const ownDecision: NonNullable<RecordWords['ownDecision']> = (conflict, conflicts) => {
  if (isDuplicateConflict(conflict)) {
    return <DuplicateDecision conflict={conflict} followers={followersOf(conflict, conflicts)} />
  }

  return conflicts.some(
    (other) =>
      isDuplicateConflict(other) &&
      followersOf(other, conflicts).some((follower) => follower.id === conflict.id),
  )
    ? null
    : undefined
}

/** "1 Foto und 1 Etikett", or nothing where the asset was sent alone. */
function waitingWords(followers: readonly SyncConflict[]): string {
  const count = (entity: string) => followers.filter((each) => each.entity === entity).length
  const [photos, labels] = [count('attachments'), count('labels')]

  return [
    photos === 0 ? null : photos === 1 ? '1 Foto' : `${String(photos)} Fotos`,
    labels === 0 ? null : labels === 1 ? '1 Etikett' : `${String(labels)} Etiketten`,
  ]
    .filter((part) => part !== null)
    .join(' und ')
}

function DuplicateDecision({
  conflict,
  followers,
}: {
  readonly conflict: SyncConflict
  readonly followers: readonly SyncConflict[]
}) {
  const client = useSync()
  const entry = useEntry()
  const assets = useRecords('assets')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const labels = useRecords('labels')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const { wanted } = conflict

  // After the exchange the device holds the asset that is there, if it lies
  // in the areas of the person. One it does not hold is not shown, and the
  // card says only that there is one.
  const there = possibleDuplicates(
    { serialNumber: wanted['serialNumber'], mark: wanted['mark'] },
    assets,
  )
  const shared = sameWords(conflict.fields as DuplicateField[])
  const sharedInLine = shared.charAt(0).toLowerCase() + shared.slice(1)
  const waiting = waitingWords(followers)
  // A version is the file of its document and is not counted beside it.
  const waits = followers.filter((each) => each.entity !== 'attachment_versions').length

  const whereIs = (asset: RecordState) => {
    const room = rooms.find((each) => each['id'] === asset['roomId']) ?? null
    const building = buildings.find((each) => each['id'] === asset['buildingId']) ?? null

    return [maybeText(building, 'name'), room ? titleOfRoom(room) : null]
      .filter((part) => part !== null && part !== '')
      .join(', ')
  }

  /**
   * Hangs what was sent with the asset on the asset it belongs to now: each
   * document anew with its versions, whose files the server has, and the
   * label, if the asset may have it. A label the asset may not have stays
   * free, and its scan says so.
   */
  async function hang(assetId: string, propertyId: string): Promise<void> {
    for (const document of followers.filter((each) => each.entity === 'attachments')) {
      const filed = await client.create('attachments', {
        ...document.wanted,
        propertyId,
        assetId,
      })

      if (filed.outcome === 'refused') {
        throw new Error(refusalFor(filed))
      }

      for (const version of followers.filter(
        (each) =>
          each.entity === 'attachment_versions' &&
          each.wanted['attachmentId'] === document.recordId,
      )) {
        const added = await client.create('attachment_versions', {
          ...version.wanted,
          attachmentId: filed.id,
        })

        if (added.outcome === 'refused') {
          throw new Error(refusalFor(added))
        }
      }
    }

    for (const sticker of followers.filter((each) => each.entity === 'labels')) {
      const label = labels.find((each) => each['id'] === sticker.recordId)
      const labelled = labels.some(
        (each) => each['assetId'] === assetId && maybeText(each, 'blockedAt') === null,
      )

      if (label && labelAssignmentRefusal(label, { propertyId }, labelled) === null) {
        await client.update('labels', sticker.recordId, { assetId })
      }
    }
  }

  async function close() {
    for (const each of [conflict, ...followers]) {
      await client.resolveConflict(each.id)
    }
  }

  async function decide(what: () => Promise<void>) {
    setWorking(true)
    setTrouble(null)

    try {
      await what()
      await close()
    } catch (error) {
      setTrouble(
        error instanceof Error && error.message !== ''
          ? error.message
          : duplicateDecisionWords.notDecided,
      )
    } finally {
      setWorking(false)
    }
  }

  /** Makes the asset at its route after all, where the server asks no second time, and hangs the rest on it. */
  const anyway = () =>
    decide(async () => {
      const building = buildings.find((each) => each['id'] === wanted['buildingId'])
      const parent = maybeText(wanted, 'parentAssetId')
      const values: unknown =
        typeof wanted['values'] === 'string' ? JSON.parse(wanted['values']) : undefined
      const made = await makeAt(
        client,
        parent === null
          ? `/buildings/${String(wanted['buildingId'])}/assets`
          : `/assets/${parent}/components`,
        {
          ...Object.fromEntries(
            routeFields
              .filter((field) => wanted[field] !== undefined && wanted[field] !== null)
              .map((field) => [field, wanted[field]]),
          ),
          ...(values === undefined ? {} : { values }),
          ...(parent === null && maybeText(wanted, 'roomId') !== null
            ? { roomId: wanted['roomId'] }
            : {}),
        },
      )

      if (made.outcome === 'refused') {
        throw new Error(made.message ?? duplicateDecisionWords.notDecided)
      }

      const propertyId = maybeText(building, 'propertyId')

      if (propertyId !== null) {
        await hang(made.id, propertyId)
      }
    })

  const sameAs = (asset: RecordState) =>
    decide(() => hang(String(asset['id']), text(asset, 'propertyId')))

  const wide = entry === 'site'
  const title = (asset: RecordState) =>
    [maybeText(asset, 'number'), text(asset, 'name')].filter(Boolean).join(' ')

  return (
    <DecisionFrame
      kind={duplicateDecisionWords.kind}
      title={maybeText(wanted, 'name') ?? duplicateDecisionWords.noName}
      reason={
        there.length > 0
          ? `Mögliche Dublette: ${sharedInLine} wie eine Anlage, die es schon gibt.`
          : `Mögliche Dublette: ${sharedInLine} wie eine Anlage außerhalb Ihrer Bereiche. Dieses Gerät zeigt sie nicht.`
      }
    >
      {there.length === 0 ? null : (
        <ul aria-label="Anlagen, die es schon gibt" className="flex flex-col gap-2">
          {there.map(({ asset }) => (
            <li
              key={String(asset['id'])}
              className="rounded-[6px] border border-line bg-ground px-3 py-2.5"
            >
              <Link
                to={`/anlagen/${String(asset['id'])}`}
                className="font-semibold text-copper-text underline underline-offset-2 [overflow-wrap:anywhere]"
              >
                {title(asset)}
              </Link>
              <span className="block text-ink-muted [overflow-wrap:anywhere]">
                {whereIs(asset)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {waiting === '' ? null : (
        <p className="text-ink-muted">
          {`Mit dieser Aufnahme ${waits === 1 ? 'wartet' : 'warten'} ${waiting}. ${waits === 1 ? duplicateDecisionWords.goesWith : duplicateDecisionWords.goWith}`}
        </p>
      )}

      {trouble ? (
        <p role="alert" className="font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className={wide ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        {there.length === 0 ? (
          <Button
            tone="dark"
            wide={wide}
            height={56}
            disabled={working}
            onClick={() => {
              void decide(() => Promise.resolve())
            }}
          >
            {duplicateDecisionWords.drop}
          </Button>
        ) : (
          there.map(({ asset }) => (
            <Button
              key={String(asset['id'])}
              tone="dark"
              wide={wide}
              height={56}
              disabled={working}
              onClick={() => {
                void sameAs(asset)
              }}
            >
              {there.length === 1
                ? duplicateDecisionWords.same
                : `Ist dieselbe wie ${maybeText(asset, 'number') ?? text(asset, 'name')}`}
            </Button>
          ))
        )}
        <Button
          wide={wide}
          height={56}
          disabled={working}
          onClick={() => {
            void anyway()
          }}
        >
          {duplicateDecisionWords.anyway}
        </Button>
      </div>
    </DecisionFrame>
  )
}
