import 'reflect-metadata'

import { shippedRoles } from '@opengewerk/haustechnik-domain'
import { Database } from '@opengewerk/platform-server'

import { applicationDatabaseUrl } from '../database/test-database.js'
import { startDeadlineWorker } from '../deadlines/engine.js'
import {
  preparePreviewDatabase,
  previewDatabaseUrl,
  previewPort,
  PreviewRefused,
  previewViewer,
  refuseProduction,
} from './preview-database.js'
import { openSamplePreview, previewCatalogue } from './preview-server.js'

/**
 * Starts the preview: `pnpm run preview` in the root of the repository, which
 * builds the interface first (#29).
 *
 * A fresh database with a sample operator on every start, the server on
 * 127.0.0.1, and every request counted as one person of that operator, with
 * the role `PREVIEW_ROLE` names and the area `PREVIEW_AREA` names. What keeps
 * this away from an instance is written at each fence: this folder is not
 * compiled into `dist`, the start is refused under `NODE_ENV=production` and
 * against a database that is not local or not named for the purpose, and the
 * address to listen on is not configurable.
 */
async function start(): Promise<void> {
  refuseProduction()

  const url = previewDatabaseUrl()
  const port = previewPort()
  const viewer = previewViewer()

  const admin = await preparePreviewDatabase(url)
  const database = Database.connect(applicationDatabaseUrl(url))
  let opened: Awaited<ReturnType<typeof openSamplePreview>>

  try {
    opened = await openSamplePreview(admin, database, viewer)
  } finally {
    await admin.end()
  }

  const { application, tenant } = opened

  // 127.0.0.1 and nothing else, whatever HOST says. A server that lets every
  // request through has no business on an interface somebody else can reach.
  await application.listen(port, '127.0.0.1')

  // The deadlines run as on an instance, so that the list "Fristen" knows
  // when its last run was.
  const deadlines = startDeadlineWorker({ database, catalogue: previewCatalogue })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void deadlines
        .stop()
        .then(() => application.close())
        .then(() => database.close())
    })
  }

  const role = shippedRoles.find((each) => each.key === viewer.role)?.label ?? viewer.role
  const who = `${role}${viewer.area === null ? '' : `, Bereich ${viewer.area}`}`

  // The CI waits for this line before it measures the widths.
  console.info(
    `Die Vorschau läuft unter http://127.0.0.1:${String(port)}, als ${who} des ` +
      `Beispielbetreibers "${tenant.name}". Jede Anfrage läuft ohne Anmeldung, nur auf diesem Rechner.`,
  )
}

start().catch((error: unknown) => {
  // A refusal says why in a sentence; anything else is a fault and keeps its trace.
  console.error(error instanceof PreviewRefused ? error.message : error)
  process.exitCode = 1
})
