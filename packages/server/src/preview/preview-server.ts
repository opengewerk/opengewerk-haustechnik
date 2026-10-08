import { createHash } from 'node:crypto'
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
  newId,
  readRendererConfiguration,
  rendererFor,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'

import { ApiModule } from '../api/api.module.js'
import { access } from '../authentication/access.js'
import { runDeadlineCycle } from '../deadlines/engine.js'
import {
  admitPreviewPeople,
  previewIdentity,
  previewPeople,
  type PreviewPerson,
  previewPort,
  type PreviewViewer,
} from './preview-database.js'
import { PreviewIdentitySource, previewSession } from './preview-identity.js'
import { planSampleActivities, plantSampleData, sampleOperatorName } from './sample-data.js'
import { writeSampleStandings } from './sample-standings.js'

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
    }),
    {
      authenticationHandler: previewSession(identity, person),
      serverPaths,
      ...(options.interfaceDirectory === undefined
        ? {}
        : { interfaceDirectory: options.interfaceDirectory }),
    },
  )

  return application
}

/** A file store for one start of the preview, in a folder of its own. */
function previewFileStore(): FileStorage {
  return new FileStore(mkdtempSync(join(tmpdir(), 'haustechnik-vorschau-')))
}

/**
 * The catalogue of the preview as a bundle: the packages this build ships,
 * and beside them the probe package. The build ships the package Allgemein
 * (#61), whose asset kinds carry no duty kind and no field; the packages with
 * duty kinds, measuring points and forms come later in Phase 1, and until
 * then the probe package is the one that shows them.
 *
 * Its checksum is taken over the checksums of both, so that a device tells
 * this catalogue from either of the two alone.
 */
export const previewBundle: CatalogueBundle = {
  format: catalogueBundle.format,
  sha256: createHash('sha256')
    .update(`${catalogueBundle.sha256} ${probeCatalogueBundle.sha256}`)
    .digest('hex'),
  packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
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

    // What no route writes yet: the defects and the labels of a sheet.
    await writeSampleStandings(database, planter, planted)

    // One pass of the engine, so that the due days have their inspections
    // before somebody looks, and two of them planned (#105).
    await runDeadlineCycle({ database, catalogue: previewCatalogue })
    await planSampleActivities(`http://127.0.0.1:${String(port)}`, areas)
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
