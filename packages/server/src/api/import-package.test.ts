import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import {
  assetImportFields,
  catalogueOf,
  type ColumnMapping,
  deadlineImportFields,
  type DutyDetails,
  type IsoDate,
  fieldOfColumn,
  type MeterDetails,
  type MeterList,
  meterImportFields,
  type RoleKey,
  roleKeys,
  structureFields,
  suggestedMapping,
  tableBodyType,
  tableColumns,
  type TableField,
  type TableFile,
  tableFileNameHeader,
  tableFileType,
  type TableSheet,
  templateImportFields,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

// The format of the package a predecessor application exports into is written
// down in `docs/import/Importpaket.md`, with an example package of invented
// data beside it (#130). A page and an example say what was true on the day
// they were written. This takes the example over as the page says, file by
// file through the routes a browser asks, into an instance that holds
// nothing, and holds what each import answers against the table of the page:
// a field that is renamed, a rule that gets stricter or a file that is
// changed turns this red until page and example say so too.
//
// It is the trial run section 11 of the concept asks for, with the figures
// compared, as far as a test can run one.

const root = new URL('../../../../', import.meta.url)
const folder = new URL('docs/import/beispielpaket/', root)
const page = readFileSync(fileURLToPath(new URL('docs/import/Importpaket.md', root)), 'utf8')

function file(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(name, folder)))
}

/** What the page says each file of the example makes, by the name of the file. */
function said(name: string): string | undefined {
  const line = page.split(/\r?\n/).find((each) => each.startsWith(`| \`${name}\` |`))

  return line
    ?.split('|')
    .map((cell) => cell.trim())
    .at(-2)
}

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
}

let admin: Pool
let database: Database
let app: INestApplication
let tenantId: TenantId
let areaId: string
let keeper: string

function http() {
  return request(app.getHttpServer())
}

/** The first sheet of a file of the example, read by the route a page sends the file to. */
async function sheetOf(path: string, name: string): Promise<TableSheet> {
  const answer = await http()
    .post(`${path}/table`)
    .set(testIdentityHeader, keeper)
    .set('Content-Type', tableFileType)
    .set(tableFileNameHeader, encodeURIComponent(name))
    .send(file(name))
    .expect(200)
  const [sheet] = (answer.body as TableFile).sheets

  if (sheet === undefined) {
    throw new Error(`${name} holds no sheet`)
  }

  return sheet
}

/** The sheet with every column given the field its name says; a column that names none is a slip of the example. */
function tableOf(
  sheet: TableSheet,
  fields: readonly TableField[],
): { sheet: TableSheet; mapping: ColumnMapping } {
  const mapping = suggestedMapping(tableColumns(sheet), fields)

  expect(
    tableColumns(sheet)
      .filter((column) => fieldOfColumn(mapping, column.index) === null)
      .map((column) => column.name),
  ).toEqual([])

  return { sheet, mapping }
}

function send(path: string, body: unknown) {
  return http()
    .post(path)
    .set(testIdentityHeader, keeper)
    .set('Content-Type', tableBodyType)
    .send(JSON.stringify(body))
}

interface Preview {
  readonly counts: Readonly<Record<string, number>>
  readonly problems: readonly { readonly what: string; readonly lines: readonly number[] }[]
}

/** Takes a table over as the page does: the preview first, without a line to clear up, then with its counts. */
async function taken(path: string, name: string, body: object): Promise<string> {
  const shown = (await send(`${path}/preview`, body).expect(200)).body as Preview

  expect(shown.problems, `the preview of ${name}`).toEqual([])

  const answer = await send(path, { ...body, fileName: name, expected: shown.counts })

  expect([answer.status, (answer.body as { message?: string }).message], name).toEqual([
    201,
    undefined,
  ])

  return (answer.body as { summary: string }).summary
}

async function rows<Row>(sql: string): Promise<Row[]> {
  return (await admin.query(sql, [tenantId])).rows as Row[]
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  tenantId = newId<'tenant'>() as TenantId
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenantId, 'Beispielträger'])

  for (const role of roleKeys) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      people[role],
      people[role],
      `${people[role]}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenantId,
      people[role],
      [role],
    ])
  }

  areaId = (
    await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [tenantId])
  ).rows[0]?.id as string
  keeper = as(tenantId, people.technical_management, 'technical_management')
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        // The packages the build ships and nothing beside them: the meters of
        // the example take the asset kinds of the package Messstellen, as
        // in an instance that holds no probe package (#287).
        catalogue: catalogueOf(catalogueBundle),
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the example package of the import', () => {
  it('is the folder the page describes: five tables and the files its list of deadlines names', () => {
    const names = readdirSync(fileURLToPath(folder)).sort()
    const evidence = readdirSync(fileURLToPath(new URL('nachweise/', folder))).sort()

    expect(names).toEqual([
      '01-bestand.csv',
      '02-anlagen.csv',
      '03-fristen.csv',
      '04-zaehler.csv',
      '05-vorlagen.csv',
      'nachweise',
    ])

    // Every table is named by the page, and every other file by a line of the list.
    const list = file('03-fristen.csv').toString('utf8')

    expect(names.filter((name) => name !== 'nachweise' && !page.includes(name))).toEqual([])

    expect(evidence.filter((name) => !list.includes(name))).toEqual([])
  })

  it('is taken over whole in the order of the page, and each import makes what the page says', async () => {
    const made: Record<string, string> = {}

    // 1. The places, into the one area of the operator.
    made['01-bestand.csv'] = await taken('/imports/structure', '01-bestand.csv', {
      ...tableOf(await sheetOf('/imports/structure', '01-bestand.csv'), structureFields),
      defaults: { areaId, federalState: null, buildingKinds: [] },
    })

    // 2. The assets, once the words of the list have their asset kinds.
    await http()
      .put('/imports/asset-kinds')
      .set(testIdentityHeader, keeper)
      .send({
        names: [
          { name: 'Heizkessel', kind: 'allgemein.heat_supply' },
          { name: 'Aufzug', kind: 'allgemein.conveying_system' },
          { name: 'Lüftungsgerät', kind: 'allgemein.ventilation_and_air_conditioning' },
          { name: 'Wasserzähler', kind: 'messstellen.water_meter' },
          { name: 'Stromzähler', kind: 'messstellen.electricity_meter' },
        ],
      })
      .expect(200)
    made['02-anlagen.csv'] = await taken(
      '/imports/assets',
      '02-anlagen.csv',
      tableOf(await sheetOf('/imports/assets', '02-anlagen.csv'), assetImportFields),
    )

    // 3. The running deadlines, their files gone up ahead as a browser sends them.
    const files = readdirSync(fileURLToPath(new URL('nachweise/', folder))).map((name) => {
      const bytes = file(`nachweise/${name}`)

      return {
        name,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
        previewSha256: null,
      }
    })

    for (const each of files) {
      await admin.query(
        `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, 'application/pdf')`,
        [tenantId, each.sha256, each.sizeBytes],
      )
    }

    made['03-fristen.csv'] = await taken('/imports/deadlines', '03-fristen.csv', {
      ...tableOf(await sheetOf('/imports/deadlines', '03-fristen.csv'), deadlineImportFields),
      files,
    })

    // 4. The history of the meters.
    made['04-zaehler.csv'] = await taken(
      '/imports/meters',
      '04-zaehler.csv',
      tableOf(await sheetOf('/imports/meters', '04-zaehler.csv'), meterImportFields),
    )

    // 5. The templates of the rounds.
    made['05-vorlagen.csv'] = await taken(
      '/imports/templates',
      '05-vorlagen.csv',
      tableOf(await sheetOf('/imports/templates', '05-vorlagen.csv'), templateImportFields),
    )

    expect(made).toEqual(Object.fromEntries(Object.keys(made).map((name) => [name, said(name)])))
  })

  it('leaves every deadline due on the day its list names', async () => {
    const duties = await rows<{ id: string; label: string }>(
      'select id, label from duties where tenant_id = $1 order by label',
    )
    const due: Record<string, string | undefined> = {}

    for (const duty of duties) {
      const details = (
        await http().get(`/duties/${duty.id}`).set(testIdentityHeader, keeper).expect(200)
      ).body as DutyDetails

      due[duty.label] = details.appointment?.dueOn
    }

    expect(due).toEqual({
      // Named by the list.
      'Wartung des Aufzugs': '2026-09-12',
      'Wartung des Gaskessels': '2026-11-04',
      // Counted from the evidence, six months on: the list names no day.
      'Filterwechsel der Lüftung': '2026-07-15',
    })
    expect(
      await rows(
        `select origin, count(*)::int as evidence from evidence where tenant_id = $1 group by origin`,
      ),
    ).toEqual([{ origin: 'legacy', evidence: 3 }])
    expect(
      await rows(
        `select legacy, count(*)::int as documents from attachments where tenant_id = $1 group by legacy`,
      ),
      // The four files: two beside their evidence, two as documents of their own.
    ).toEqual([{ legacy: true, documents: 4 }])
  })

  it('leaves the meters with their readings, across the replacement and the rest', async () => {
    const meters = await rows<{ id: string; mark: string }>(
      `select id, mark from assets where tenant_id = $1 and meter_number is not null order by mark`,
    )
    const pages: Record<string, MeterDetails> = {}

    for (const meter of meters) {
      pages[meter.mark] = (
        await http().get(`/meters/${meter.id}`).set(testIdentityHeader, keeper).expect(200)
      ).body as MeterDetails
    }

    const read = (mark: string) =>
      pages[mark]?.rows.flatMap((row) =>
        row.reading === null ? [] : [[row.keyDate, row.reading.valueMilli, row.reading.source]],
      )

    expect(read('GS-WZ-01')).toEqual([
      ['2026-03-01', 31_300, 'taken_over'],
      ['2026-02-01', 9_600, 'taken_over'],
      ['2026-01-01', 4_748_000, 'taken_over'],
      ['2025-12-01', 4_731_900, 'taken_over'],
      ['2025-11-01', 4_712_400, 'taken_over'],
    ])
    expect(pages['GS-WZ-01']?.exchanges.map((each) => [each.oldNumber, each.newNumber])).toEqual([
      ['W-1187', 'W-2001'],
    ])
    expect(read('GS-WZ-02')).toHaveLength(3)
    // The electricity meter beside them, in kWh.
    expect(read('GS-SZ-01')).toEqual([
      ['2026-03-01', 63_611_000, 'taken_over'],
      ['2026-02-01', 61_027_000, 'taken_over'],
      ['2026-01-01', 58_214_000, 'taken_over'],
    ])
    expect(pages['GS-WZ-02']?.pauses.map((each) => [each.startsOn, each.endsOn])).toEqual([
      ['2025-12-01', '2026-02-28'],
    ])
  })

  // The acceptance of #287: in an instance with only the packages of the
  // build, a water meter and an electricity meter come by the import and by
  // the form, stand in the list "Zähler" and take a reading.
  it('holds a water meter and an electricity meter of the packages the build ships, by the form too, and reads them', async () => {
    const [hall] = await rows<{ id: string }>(
      `select id from buildings where tenant_id = $1 and name = 'Sporthalle'`,
    )
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(
      new Date(),
    ) as IsoDate

    for (const [kind, mark, meterUnit] of [
      ['messstellen.water_meter', 'GS-WZ-03', 'cubic_metres'],
      ['messstellen.electricity_meter', 'GS-SZ-02', 'kilowatt_hours'],
    ] as const) {
      const made = await http()
        .post(`/buildings/${hall?.id ?? ''}/assets`)
        .set(testIdentityHeader, keeper)
        .send({ kind, name: `Unterzähler ${mark}`, mark, meterNumber: `N-${mark}`, meterUnit })
        .expect(201)

      await http()
        .post(`/meters/${(made.body as { id: string }).id}/readings`)
        .set(testIdentityHeader, keeper)
        .send({ readOn: today, valueMilli: 1_250 })
        .expect(201)
    }

    const list = (await http().get('/meters').set(testIdentityHeader, keeper).expect(200))
      .body as MeterList

    expect(
      Object.fromEntries(
        list.meters.map((meter) => [
          meter.mark,
          [meter.medium, meter.unit, meter.lastReading?.valueMilli ?? null],
        ]),
      ),
    ).toEqual({
      'GS-SZ-01': ['electricity', 'kilowatt_hours', 63_611_000],
      'GS-WZ-01': ['water', 'cubic_metres', 31_300],
      'GS-WZ-02': ['water', 'cubic_metres', 827_100],
      'GS-SZ-02': ['electricity', 'kilowatt_hours', 1_250],
      'GS-WZ-03': ['water', 'cubic_metres', 1_250],
    })
  })

  it('makes nothing when it is taken over a second time', async () => {
    const before = await rows(
      `select (select count(*)::int from assets where tenant_id = $1) as assets,
              (select count(*)::int from evidence where tenant_id = $1) as evidence,
              (select count(*)::int from meter_readings where tenant_id = $1) as readings,
              (select count(*)::int from round_templates where tenant_id = $1) as templates`,
    )

    for (const [path, name, fields] of [
      ['/imports/deadlines', '03-fristen.csv', deadlineImportFields],
      ['/imports/meters', '04-zaehler.csv', meterImportFields],
      ['/imports/templates', '05-vorlagen.csv', templateImportFields],
    ] as const) {
      const body = tableOf(await sheetOf(path, name), fields)
      const shown = (
        await send(`${path}/preview`, {
          ...body,
          files: readdirSync(fileURLToPath(new URL('nachweise/', folder))).map((each) => ({
            name: each,
          })),
        }).expect(200)
      ).body as Preview

      expect(shown.problems, name).toEqual([])
      expect(
        Object.entries(shown.counts).filter(([key, count]) => key !== 'known' && count > 0),
        name,
      ).toEqual([])
    }

    expect(
      await rows(
        `select (select count(*)::int from assets where tenant_id = $1) as assets,
                (select count(*)::int from evidence where tenant_id = $1) as evidence,
                (select count(*)::int from meter_readings where tenant_id = $1) as readings,
                (select count(*)::int from round_templates where tenant_id = $1) as templates`,
      ),
    ).toEqual(before)
  })
})
