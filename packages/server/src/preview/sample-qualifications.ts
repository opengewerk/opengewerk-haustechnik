import { createHash } from 'node:crypto'

import { addDays } from '@opengewerk/haustechnik-domain'

import { dayInGermany } from '../today.js'
import { previewColleagues, previewPeople } from './preview-database.js'
import { samplePdf } from './sample-documents.js'

/**
 * The qualifications of the sample operator (#337), as the board
 * "Qualifikationen" draws them: some that hold, one that ends within its
 * lead, one that ran out, one without an end and one of the operator's own
 * kind, a certificate at one of them, and one of the viewer, to be seen
 * under "Konto". Planted through the routes by the Leitung.
 */
interface SampleQualification {
  /** The colleague by name; the viewer where there is none. */
  readonly person: string | null
  readonly kind: string
  /** The last day, in days from today; none where it does not end. */
  readonly until: number | null
  readonly certificate?: string
}

const ownKind = 'Hygieneschulung Trinkwasser'

const sampleQualifications: readonly SampleQualification[] = [
  {
    person: 'Murat Yilmaz',
    kind: 'elektro.electrically_skilled_person',
    until: 165,
    certificate: 'Bestellung zur Elektrofachkraft, Murat Yilmaz',
  },
  { person: 'Lena Vogt', kind: 'elektro.electrically_instructed_person', until: -32 },
  { person: 'Tobias Wendt', kind: 'brandschutz.fire_extinguisher_expert', until: null },
  { person: 'Tobias Wendt', kind: ownKind, until: 134 },
  { person: 'Dennis Roth', kind: 'elektro.electrically_skilled_person', until: 800 },
  { person: null, kind: 'elektro.electrically_skilled_person', until: 40 },
]

async function answered<Answer>(address: string, path: string, init: RequestInit): Promise<Answer> {
  const response = await fetch(`${address}${path}`, init)

  if (!response.ok) {
    throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
  }

  return (await response.json()) as Answer
}

const posted = <Answer>(address: string, path: string, body: unknown) =>
  answered<Answer>(address, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Plants the sample qualifications through the routes of the preview at `address`. */
export async function plantSampleQualifications(address: string): Promise<void> {
  const today = dayInGermany()
  const own = await posted<{ key: string }>(address, '/qualifications/kinds', {
    label: ownKind,
    level: 'instructed_person',
  })

  for (const sample of sampleQualifications) {
    const userId =
      sample.person === null
        ? previewPeople.viewer.id
        : previewColleagues.find((colleague) => colleague.name === sample.person)?.id

    if (userId === undefined) {
      throw new Error(`${String(sample.person)} ist keine Person der Beispieldaten.`)
    }

    let certificateSha256: string | undefined

    if (sample.certificate !== undefined) {
      const bytes = samplePdf(sample.certificate)

      certificateSha256 = createHash('sha256').update(bytes).digest('hex')
      await answered(address, `/qualifications/certificates/${certificateSha256}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'x-media-type': 'application/pdf' },
        body: bytes,
      })
    }

    await posted(address, '/qualifications', {
      userId,
      kind: sample.kind === ownKind ? own.key : sample.kind,
      validUntil: sample.until === null ? null : addDays(today, sample.until),
      ...(certificateSha256 === undefined ? {} : { certificateSha256 }),
    })
  }
}
