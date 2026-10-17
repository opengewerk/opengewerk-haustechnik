import {
  addDays,
  type Catalogue,
  type DelegationReading,
  type DelegationScope,
  type Identity,
  rightsOfRoles,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { inArray } from 'drizzle-orm'

import { dutyDelegations, dutyDelegationSignatures } from '../database/schema/index.js'
import { applyDelegations } from '../delegations/apply.js'
import { heldDelegations, pageOf } from '../delegations/reading.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { dayInGermany } from '../today.js'
import {
  type PreviewArea,
  previewColleagues,
  previewPeople,
  type PreviewViewer,
} from './preview-database.js'

/** A signature as a finger draws it on a telephone, in the units of `signatureBox`. */
const sampleSignature = 'M90,250L180,140L260,280L350,130L450,270L540,150L650,250L760,190L880,220'

/** What the sample delegations hand over, in the words of the board "Pflichtenübertragung anlegen". */
const sampleTasks =
  'Organisation der wiederkehrenden Prüfungen und Wartungen der Anlagen im Umfang; Beauftragung von Fremdfirmen im Rahmen der bestehenden Verträge; Nachverfolgung der Mängel bis zur Nachprüfung.'
const samplePowers =
  'Weisungsbefugnis gegenüber den Beschäftigten der Haustechnik im Bereich; Anordnung der Außerbetriebnahme einer Anlage bei Gefahr; Ausgaben bis 5.000 € je Auftrag ohne Rückfrage.'

interface SampleDelegation {
  /** The colleague it goes to, by name; the viewer where there is none. */
  readonly delegate: string | null
  readonly areas: readonly PreviewArea[]
  readonly scope: DelegationScope
  readonly packages?: readonly string[]
  readonly costGroups?: readonly string[]
  /** Its start and its end, in days from today. */
  readonly from: number
  readonly to: number
  /** Whether the person it goes to signed too, behind the routes. */
  readonly signedByBoth: boolean
}

/**
 * The delegations of the sample operator (#336), as the board
 * "Pflichtenübertragungen" draws them: one in force, one in force that ends
 * within its lead, one that ended, and one that waits for the signature of
 * the person it goes to; and, where the viewer may see duties, one to the
 * viewer, to be read and signed under "Konto".
 */
const sampleDelegations: readonly SampleDelegation[] = [
  {
    delegate: 'Petra Lindner',
    areas: ['Nord'],
    // The lifts of the north, with the duties of the catalogue and the operator's own at them.
    scope: 'cost_groups',
    costGroups: ['460', '461'],
    from: -230,
    to: 135,
    signedByBoth: true,
  },
  {
    delegate: 'Dennis Roth',
    areas: ['Süd'],
    scope: 'packages',
    packages: ['probe'],
    from: -340,
    to: 20,
    signedByBoth: true,
  },
  {
    delegate: 'Tobias Wendt',
    areas: ['Süd'],
    scope: 'packages',
    packages: ['elektro'],
    from: -500,
    to: -136,
    signedByBoth: true,
  },
  {
    delegate: 'Jörg Albrecht',
    areas: ['Nord', 'Süd'],
    scope: 'all',
    from: 15,
    to: 744,
    signedByBoth: false,
  },
]

const toViewer: SampleDelegation = {
  delegate: null,
  areas: ['Nord'],
  scope: 'packages',
  packages: ['allgemein'],
  from: 0,
  to: 364,
  signedByBoth: false,
}

/** The ones the person it goes to signed too, which the planting signs behind the routes. */
export type SignedByTheDelegate = readonly string[]

/**
 * Plants the sample delegations through the routes of the preview at
 * `address`, each written and signed for the operator by the Leitung. Which
 * of them the person it goes to signed as well is handed back, for
 * `giveSampleDelegations`.
 */
export async function plantSampleDelegations(
  address: string,
  areas: ReadonlyMap<PreviewArea, string>,
  viewer: PreviewViewer,
): Promise<SignedByTheDelegate> {
  const today = dayInGermany()
  const viewerReads = rightsOfRoles([viewer.role]).has('duty.read')
  const signed: string[] = []

  // In the area of the viewer, who sees every area a delegation to them names.
  const mine = { ...toViewer, areas: [viewer.area ?? 'Nord'] }

  for (const sample of viewerReads ? [...sampleDelegations, mine] : sampleDelegations) {
    const delegateUserId =
      sample.delegate === null
        ? previewPeople.viewer.id
        : previewColleagues.find((colleague) => colleague.name === sample.delegate)?.id

    if (delegateUserId === undefined) {
      throw new Error(`${String(sample.delegate)} ist keine Person der Beispieldaten.`)
    }

    const made = await answer<DelegationReading>(address, '/delegations', {
      delegateUserId,
      areaIds: sample.areas.map((area) => areas.get(area)),
      scope: sample.scope,
      packages: sample.packages ?? [],
      costGroups: sample.costGroups ?? [],
      tasks: sampleTasks,
      powers: samplePowers,
      startsOn: addDays(today, sample.from),
      endsOn: addDays(today, sample.to),
    })

    await answer(address, `/delegations/${made.id}/sign`, {
      path: sampleSignature,
      pageFingerprint: stateFingerprint(made.page),
    })

    if (sample.signedByBoth) {
      signed.push(made.id)
    }
  }

  return signed
}

/**
 * What no route writes for the sample operator: the signature of the person
 * a delegation goes to, which only that person gives, under "Konto"; and
 * then the delegations applied to the duties, as the route does after it.
 */
export async function giveSampleDelegations(
  database: Database,
  planter: Identity,
  catalogue: Catalogue,
  signed: SignedByTheDelegate,
): Promise<void> {
  await database.forTenant(planter, async (tx) => {
    if (signed.length > 0) {
      for (const held of await heldDelegations(
        tx,
        inArray(dutyDelegations.id, signed as never[]),
      )) {
        await tx.insert(dutyDelegationSignatures).values({
          tenantId: planter.tenantId,
          delegationId: held.delegation.id,
          role: 'delegate',
          signedBy: held.delegation.delegateUserId,
          signedAt: new Date(),
          path: sampleSignature,
          typedName: null,
          pageFingerprint: stateFingerprint(pageOf(held)),
        })
      }
    }

    await applyDelegations(tx, catalogue, dayInGermany())
  })
}

/** A request of the planting, answered with what the server sent back; a refusal stops the start. */
async function answer<Answer = unknown>(
  address: string,
  path: string,
  body: unknown,
): Promise<Answer> {
  const response = await fetch(`${address}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
  }

  return (await response.json()) as Answer
}
