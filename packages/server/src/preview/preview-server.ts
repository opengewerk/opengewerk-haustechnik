import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type Catalogue,
  type CatalogueBundle,
  catalogueOf,
  type Identity,
  serverPaths,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  completeRoles,
  createServer,
  type Database,
  type FileStorage,
  FileStore,
  type MailContext,
  newId,
  type PushContext,
  readRendererConfiguration,
  rendererFor,
  SecretKey,
  vapidKeysFrom,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'

import { ApiModule } from '../api/api.module.js'
import { OutsideReports } from '../faults/outside-gate.js'
import { access } from '../authentication/access.js'
import { runDeadlineCycle } from '../deadlines/engine.js'
import { dayInGermany } from '../today.js'
import {
  admitPreviewPeople,
  previewIdentity,
  previewPeople,
  type PreviewPerson,
  previewPort,
  type PreviewViewer,
} from './preview-database.js'
import { PreviewIdentitySource, previewSession } from './preview-identity.js'
import {
  decideSampleOrders,
  planSampleActivities,
  plantSampleData,
  sampleOperatorName,
} from './sample-data.js'
import { plantSampleTasks } from './sample-tasks.js'
import { giveSampleForm, samplePackage } from './sample-form.js'
import { withAnAnnouncedVersion } from './sample-update.js'
import { giveSamplePlans } from './sample-plans.js'
import { giveSampleTemplates } from './sample-templates.js'
import { giveSampleMeters } from './sample-meters.js'
import { giveSampleFaults, giveSampleWork } from './sample-work.js'
import { writeSampleStandings } from './sample-standings.js'
import { giveSampleDelegations, plantSampleDelegations } from './sample-delegations.js'

/**
 * The server as an instance runs it, with one difference: nobody signs in,
 * and every request counts as the given person for the given operator.
 *
 * Built for looking at the interface in a browser, by a developer and by an
 * assistant, without an account and without a password (#29). The module,
 * the guard, row level security with the areas, the routes and the interface
 * are the ones an instance runs; only where the identity comes from is
 * different, and the catalogue, which is the probe package as long as this
 * build ships none.
 *
 * The files of a preview lie in the store handed in, a folder of this start
 * under the temporary directory of the machine: a preview database is
 * nobody's, and neither are its files. The renderer is the one the
 * environment names (`RENDERER_URL`, `RENDERER_TOKEN`), as on an instance;
 * without them a PDF gets the sentence saying that none is set up.
 *
 * Mail and push are there to look at and send nothing (#126): the mail
 * server of the sample operator is taken by a transport that keeps to
 * itself, and a push message goes to a post that answers without asking
 * anybody. So the screens stand as on an instance that sends both, and no
 * address a preview invents is ever written to.
 *
 * Not listening yet. The entry point listens on 127.0.0.1, the planting of
 * the sample data and the test on a port the system picks.
 */
export async function openPreview(
  database: Database,
  identity: Identity,
  person: PreviewPerson,
  catalogue: Catalogue,
  options: { readonly interfaceDirectory?: string | null; readonly files?: FileStorage } = {},
): Promise<INestApplication> {
  const port = previewPort()
  const { application } = await createServer(
    ApiModule.create(database, new PreviewIdentitySource(identity), {
      // The address the preview is opened at, the same port under its other
      // name, vite's, which passes the page's own origin on when it serves the
      // interface next to the preview, and the name a container on this
      // machine reaches it by: the browser that checks the widths. Anything
      // else sending a change is taken for a form from somewhere else, as on
      // an instance.
      trustedOrigins: [
        `http://127.0.0.1:${String(port)}`,
        `http://localhost:${String(port)}`,
        `http://host.docker.internal:${String(port)}`,
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ],
      catalogue,
      files: options.files ?? previewFileStore(),
      renderer: rendererFor(readRendererConfiguration()),
      mail: previewMail(port),
      push: previewPush(port),
      // The page of the legal texts shows, signed in or not (#129), and the
      // preview has its sample texts.
      legalTexts: true,
      // And the page of a label for a report without an account (#332), which
      // shows with `PREVIEW_SIGNED_OUT=1`.
      outside: new OutsideReports(),
    }),
    {
      authenticationHandler: previewSession(
        identity,
        person,
        process.env['PREVIEW_SIGNED_OUT'] === '1',
      ),
      serverPaths,
      ...(options.interfaceDirectory === undefined
        ? {}
        : { interfaceDirectory: options.interfaceDirectory }),
    },
  )

  return application
}

/**
 * The key of this start, made once: the sample data are planted through one
 * opening of the preview and looked at through another, and a password sealed
 * by the first has to open for the second.
 */
const previewKey = SecretKey.from(newId().replaceAll('-', '').repeat(2))

/** The key push is signed with in this start, made once for the same reason. */
const previewVapidKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ format: 'der', type: 'pkcs8' })
  .toString('base64')

/**
 * Mail in the preview: the key of this start, and a connection that takes
 * every login and every message and sends none.
 */
function previewMail(port: number): MailContext {
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    key: previewKey,
    connect: () => ({
      send: () => Promise.resolve(),
      verify: () => Promise.resolve(),
      close: () => undefined,
    }),
  }
}

/**
 * Push in the preview: the key of this start, and a push service that says
 * yes to everything without being one.
 */
function previewPush(port: number): PushContext {
  return {
    vapid: vapidKeysFrom(previewVapidKey, `http://127.0.0.1:${String(port)}`),
    post: () => Promise.resolve({ status: 201, retryAfter: null }),
  }
}

/** A file store for one start of the preview, in a folder of its own. */
function previewFileStore(): FileStorage {
  return new FileStore(mkdtempSync(join(tmpdir(), 'haustechnik-vorschau-')))
}

/**
 * The catalogue of the preview as a bundle: the packages this build ships,
 * and beside them the probe package and a package of the preview alone. The
 * build ships the package Allgemein (#61), whose asset kinds carry no duty
 * kind and no field, the package Elektro and the measuring points of the
 * package Messstellen (#287), which the sample meters take; the probe package
 * shows the elevator with its main test and its fields, and the package of
 * the preview a form with every kind of field (#107). The probe package stands in it with a second version of its main
 * test announced, so that the preview shows what a new version means for the
 * duties that are confirmed (#139, `sample-update.ts`).
 *
 * Its checksum is taken over the checksums of the bundles, the package of the
 * preview and the probe package as it stands here, so that a device tells
 * this catalogue from any of them alone, and from the one of another day.
 */
const probePackages = probeCatalogueBundle.packages.map((pack) => withAnAnnouncedVersion(pack))

export const previewBundle: CatalogueBundle = {
  format: catalogueBundle.format,
  sha256: createHash('sha256')
    .update(
      `${catalogueBundle.sha256} ${probeCatalogueBundle.sha256} ${JSON.stringify(samplePackage)} ${JSON.stringify(probePackages)}`,
    )
    .digest('hex'),
  packages: [...catalogueBundle.packages, ...probePackages, samplePackage],
}

export const previewCatalogue: Catalogue = catalogueOf(previewBundle)

/**
 * The sample operator as the preview shows it, on a database that is empty
 * and migrated: the operator, its two areas and both people, the rows of the
 * four roles as an instance gives them to a tenant without them, the sample
 * data, and the preview of the viewer, not listening yet.
 *
 * The sample data is planted by the Leitung through a preview of its own on a
 * port the system picks, closed again before the preview of the viewer opens:
 * a browser that comes early never sees what only the Leitung may. Both keep
 * their files in one store, so that a file planted with the sample data is
 * there for the viewer. A new
 * operator on every call, and with it a new local copy in the browser, because
 * the copy of the last start would otherwise sit ahead of a database that was
 * just emptied.
 *
 * The start and the test both go through here, so that the test checks the
 * preview a browser gets and not a copy of how it is made.
 */
export async function openSamplePreview(
  admin: Pool,
  database: Database,
  viewer: PreviewViewer,
  options: { readonly interfaceDirectory?: string | null } = {},
): Promise<{
  readonly application: INestApplication
  readonly tenant: { readonly id: TenantId; readonly name: string }
}> {
  const tenant = { id: newId<'tenant'>(), name: sampleOperatorName }
  const areas = await admitPreviewPeople(admin, tenant, viewer)

  await completeRoles(database, access)

  const files = previewFileStore()
  const planter = previewIdentity(previewPeople.planter, tenant.id, 'management')
  const planting = await openPreview(database, planter, previewPeople.planter, previewCatalogue, {
    interfaceDirectory: null,
    files,
  })

  await planting.listen(0, '127.0.0.1')

  try {
    const { port } = planting.getHttpServer().address() as AddressInfo

    const planted = await plantSampleData(`http://127.0.0.1:${String(port)}`, areas)

    // What no route writes: the signatures of the work orders and the
    // labels of a sheet; and what follows a signature, through the routes.
    await writeSampleStandings(database, planter, planted, previewCatalogue)
    await decideSampleOrders(`http://127.0.0.1:${String(port)}`, planted.orders)
    // The delegations of duties (#336): written and signed for the operator
    // through the routes, the signature of the person each goes to behind
    // them, before the engine makes the deadline of each end.
    const delegations = await plantSampleDelegations(
      `http://127.0.0.1:${String(port)}`,
      areas,
      viewer,
    )

    await giveSampleDelegations(database, planter, previewCatalogue, delegations)

    // One pass of the engine, so that the due days have their inspections
    // before somebody looks, and two of them planned (#105). In the morning of
    // today: at night the engine makes nothing until the morning, and a
    // preview started then would show no inspection at all.
    const morning = new Date(`${dayInGermany()}T07:00:00Z`)

    await runDeadlineCycle({ database, catalogue: previewCatalogue, now: () => morning })
    await planSampleActivities(`http://127.0.0.1:${String(port)}`, areas)
    // Tasks for whoever looks and for colleagues, at places and assets (#124).
    await plantSampleTasks(`http://127.0.0.1:${String(port)}`)
    // A form with every kind of field on the device of the viewer (#107).
    await giveSampleForm(database, planter, previewPeople.viewer.id)
    // A template of a round with two versions (#112).
    await giveSampleTemplates(database, planter)
    // Plans of the rounds with their rounds, one of them begun (#113), one
    // signed and waiting for its countersignature and two open from before
    // (#115).
    await giveSamplePlans(database, planter, previewCatalogue)
    // An order the viewer leads, begun on site with notes and the time spent,
    // and one the viewer works on beside its lead (#118).
    await giveSampleWork(database, planter, previewPeople.viewer.id)
    // The viewer reported three of the fault reports, to see them among the own (#331).
    await giveSampleFaults(database, planter, previewPeople.viewer.id, planted.faults)
    // Two years of readings, a correction, a replacement, a pause, a lock and
    // a note on the meters of the sample operator (#119).
    await giveSampleMeters(database, planter)
  } finally {
    await planting.close()
  }

  const application = await openPreview(
    database,
    previewIdentity(previewPeople.viewer, tenant.id, viewer.role),
    previewPeople.viewer,
    previewCatalogue,
    { ...options, files },
  )

  return { application, tenant }
}
