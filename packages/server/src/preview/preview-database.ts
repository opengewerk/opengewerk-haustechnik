import {
  type Identity,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Pool } from 'pg'

import { allowApplicationLogin, applyMigrations, resetSchema } from '../database/test-database.js'

/**
 * A start of the preview that was refused, with the sentence why. Its own
 * class so that the entry point prints the sentence and not a stack trace
 * above it.
 */
export class PreviewRefused extends Error {}

/**
 * Where the preview keeps its data unless told otherwise: a database of its
 * own in the container the tests use, next to their database and never in it.
 * Started with `docker compose -f docker/compose.test.yaml up -d`.
 */
export const defaultPreviewDatabaseUrl =
  'postgres://haustechnik:haustechnik@127.0.0.1:5434/haustechnik_preview'

const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * The database the preview may use.
 *
 * It empties that database on every start, so the rules are the ones the
 * tests follow, and one more. The name has to end in `_preview`, so that no
 * development database or installation is lost to a stray variable. The
 * database has to be on this machine. And it is read from a variable of its
 * own, `PREVIEW_DATABASE_URL`, and never from `DATABASE_URL`: that one points
 * at a real database in an `.env` more often than not.
 */
export function previewDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(environment['PREVIEW_DATABASE_URL'] ?? defaultPreviewDatabaseUrl)
  const name = url.pathname.replace(/^\//, '')

  if (!localHosts.has(url.hostname)) {
    throw new PreviewRefused(
      `Die Vorschau läuft nur gegen eine Datenbank auf diesem Rechner, nicht gegen "${url.hostname}".`,
    )
  }

  // Letters, digits and underscores only, because the name ends up inside a
  // CREATE DATABASE, where a parameter cannot stand.
  if (!/^[a-z0-9_]+_preview$/.test(name)) {
    throw new PreviewRefused(
      `Die Vorschau leert ihre Datenbank bei jedem Start. Deshalb muss ihr Name aus ` +
        `Kleinbuchstaben, Ziffern und Unterstrichen bestehen und auf "_preview" enden, ` +
        `"${name}" tut das nicht.`,
    )
  }

  return url.toString()
}

/** The preview lets everything through, so it does not start where that would matter. */
export function refuseProduction(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment['NODE_ENV'] === 'production') {
    throw new PreviewRefused(
      'Die Vorschau lässt jede Anfrage ohne Anmeldung durch und startet deshalb nicht mit ' +
        'NODE_ENV=production.',
    )
  }
}

/** The port, 23800 unless `PREVIEW_PORT` says otherwise: the port of an instance, where vite's proxy looks. */
export function previewPort(environment: NodeJS.ProcessEnv = process.env): number {
  const port = Number(environment['PREVIEW_PORT'] ?? 23800)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PreviewRefused(`PREVIEW_PORT muss eine Portnummer sein, nicht "${String(port)}".`)
  }

  return port
}

/** The areas of the sample operator, by the names a start of the preview may name one by. */
export const previewAreas = ['Nord', 'Süd'] as const

export type PreviewArea = (typeof previewAreas)[number]

/**
 * Who the preview shows the interface to: a role of the four a tenant starts
 * with and, if it is to see one only, an area. `PREVIEW_ROLE` takes the key
 * of the role, `PREVIEW_AREA` the name of an area; left out, the Leitung, in
 * every area the role sees. So that what an Objektleitung or a technician does
 * not see becomes visible (#29).
 */
export interface PreviewViewer {
  readonly role: RoleKey
  readonly area: PreviewArea | null
}

export function previewViewer(environment: NodeJS.ProcessEnv = process.env): PreviewViewer {
  const role = environment['PREVIEW_ROLE'] ?? 'management'
  const area = environment['PREVIEW_AREA'] ?? null

  if (!(roleKeys as readonly string[]).includes(role)) {
    throw new PreviewRefused(
      `PREVIEW_ROLE nennt eine der Rollen ${roleKeys.join(', ')}, nicht "${role}".`,
    )
  }

  if (area !== null && !(previewAreas as readonly string[]).includes(area)) {
    throw new PreviewRefused(
      `PREVIEW_AREA nennt einen der Bereiche ${previewAreas.join(', ')}, nicht "${area}".`,
    )
  }

  return { role: role as RoleKey, area: area as PreviewArea | null }
}

/**
 * Makes sure the database exists, then empties and migrates it the way the
 * tests do, and hands back a pool on it as its owner.
 *
 * Emptied on every start rather than kept. The interface keeps a local copy
 * per tenant, and a database that was reset under a copy that was not would
 * leave the copy ahead of the server, with records the server never had. A
 * new tenant on every start gets a new copy instead.
 */
export async function preparePreviewDatabase(url: string): Promise<Pool> {
  const maintenance = new URL(url)
  maintenance.pathname = '/postgres'

  const name = new URL(url).pathname.replace(/^\//, '')
  const server = new Pool({ connectionString: maintenance.toString(), max: 1 })

  try {
    const { rowCount } = await server.query('select 1 from pg_database where datname = $1', [name])

    if (rowCount === 0) {
      await server.query(`create database "${name}"`)
    }
  } catch (cause) {
    throw new PreviewRefused(
      'Keine Datenbank erreichbar. Gestartet wird sie mit ' +
        '"docker compose -f docker/compose.test.yaml up -d".',
      { cause },
    )
  } finally {
    await server.end()
  }

  const admin = new Pool({ connectionString: url, max: 2 })

  await resetSchema(admin, url)
  await applyMigrations(url)
  await allowApplicationLogin(admin)

  return admin
}

/** A person of the preview: nobody can sign in as one, there is no sign in. */
export interface PreviewPerson {
  readonly id: string
  readonly name: string
  readonly email: string
}

/**
 * The Leitung, who plants the sample data through the routes before the
 * preview opens, and the person the interface is shown to.
 */
export const previewPeople = {
  planter: { id: 'preview-planter', name: 'Leitung (Vorschau)', email: 'leitung@vorschau.invalid' },
  viewer: { id: 'preview', name: 'Vorschau', email: 'vorschau@vorschau.invalid' },
} as const satisfies Readonly<Record<string, PreviewPerson>>

/** Somebody else who works for the sample operator: a role, and the areas named for it. */
export interface PreviewColleague extends PreviewPerson {
  readonly role: RoleKey
  /** Empty for a role that holds in every area. */
  readonly areas: readonly PreviewArea[]
}

/**
 * The colleagues of the sample operator, so that "Zugänge" lists more than
 * the two people of the preview (opengewerk-haustechnik#84): one who answers
 * for the duties across every area, and for each area whoever leads it and
 * whoever works in it. Made up like the rest of the sample data, and nobody
 * can sign in as one of them either.
 */
export const previewColleagues: readonly PreviewColleague[] = [
  {
    id: 'preview-albrecht',
    name: 'Jörg Albrecht',
    email: 'j.albrecht@beispielstadt.example',
    role: 'technical_management',
    areas: [],
  },
  {
    id: 'preview-lindner',
    name: 'Petra Lindner',
    email: 'p.lindner@beispielstadt.example',
    role: 'site_management',
    areas: ['Nord'],
  },
  {
    id: 'preview-roth',
    name: 'Dennis Roth',
    email: 'd.roth@beispielstadt.example',
    role: 'site_management',
    areas: ['Süd'],
  },
  {
    id: 'preview-yilmaz',
    name: 'Murat Yilmaz',
    email: 'm.yilmaz@beispielstadt.example',
    role: 'technician',
    areas: ['Nord'],
  },
  {
    id: 'preview-vogt',
    name: 'Lena Vogt',
    email: 'l.vogt@beispielstadt.example',
    role: 'technician',
    areas: ['Nord'],
  },
  {
    id: 'preview-wendt',
    name: 'Tobias Wendt',
    email: 't.wendt@beispielstadt.example',
    role: 'technician',
    areas: ['Süd'],
  },
]

/** That person at work for the sample operator, with what the role may do. */
export function previewIdentity(
  person: PreviewPerson,
  tenantId: TenantId,
  role: RoleKey,
): Identity {
  return { userId: person.id, tenantId, roles: [role], rights: [...rightsOfRoles([role])] }
}

/**
 * The operator, its two areas and both people, straight into the tables, the
 * way the tests set up theirs.
 *
 * The areas come before the first membership, so that the operator does not
 * begin with the one area a tenant gets with it. The Leitung sees every area
 * by its role; the viewer gets the area named, or, for a role that sees only
 * its own, both, so that a start without an area shows everything the role may
 * see. The user rows carry no credential of any kind, and the preview mounts
 * no sign in. The viewer is also the operator of the instance, as the account
 * of a first run is, so that the area of the instance can be looked at. All of
 * it in one transaction under the reason of a first run, which is what the
 * logs of the operator and of the instance then say.
 *
 * The rows of the four roles come afterwards from `completeRoles`, as on an
 * instance that finds a tenant without them. Hands back the areas by name,
 * for the sample data.
 */
export async function admitPreviewPeople(
  admin: Pool,
  tenant: { readonly id: TenantId; readonly name: string },
  viewer: PreviewViewer,
): Promise<ReadonlyMap<PreviewArea, string>> {
  const client = await admin.connect()

  try {
    await client.query('begin')
    await client.query("select set_config('app.reason', 'instance.setup', true)")
    await client.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])

    const { rows } = await client.query<{ id: string; name: string }>(
      `insert into areas (tenant_id, name) values ($1, $2), ($1, $3) returning id, name`,
      [tenant.id, ...previewAreas],
    )

    for (const [person, role] of [
      [previewPeople.planter, 'management'],
      [previewPeople.viewer, viewer.role],
    ] as const) {
      await client.query(
        `insert into auth_users (id, name, email, email_verified, two_factor_enabled)
         values ($1, $2, $3, true, true)`,
        [person.id, person.name, person.email],
      )
      await client.query(
        'insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)',
        [tenant.id, person.id, [role]],
      )
    }

    // With two areas the trigger gives a role that sees its own areas none,
    // and a role that sees every area the row that says so. The areas named
    // are set here, and a named area takes that row away again.
    for (const area of rows.filter((row) => viewer.area === null || row.name === viewer.area)) {
      await client.query(
        'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
        [tenant.id, previewPeople.viewer.id, area.id],
      )
    }

    if (viewer.area !== null) {
      await client.query('delete from member_all_areas where tenant_id = $1 and user_id = $2', [
        tenant.id,
        previewPeople.viewer.id,
      ])
    }

    // The colleagues, each with the areas named for them. Whoever holds in
    // every area got the row that says so from the trigger.
    for (const colleague of previewColleagues) {
      await client.query(
        `insert into auth_users (id, name, email, email_verified, two_factor_enabled)
         values ($1, $2, $3, true, false)`,
        [colleague.id, colleague.name, colleague.email],
      )
      await client.query(
        'insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)',
        [tenant.id, colleague.id, [colleague.role]],
      )

      for (const area of rows.filter((row) => colleague.areas.includes(row.name as PreviewArea))) {
        await client.query(
          'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
          [tenant.id, colleague.id, area.id],
        )
      }
    }

    await client.query('insert into instance_operators (user_id) values ($1)', [
      previewPeople.viewer.id,
    ])
    await client.query('commit')

    return new Map(rows.map((row) => [row.name as PreviewArea, row.id]))
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
