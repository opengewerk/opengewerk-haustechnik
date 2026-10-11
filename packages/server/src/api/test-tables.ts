import { tableFileOf, unzip } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import type request from 'supertest'

import { testIdentityHeader } from '../database/test-database.js'
import { dayInGermany } from '../today.js'

/**
 * What the tests of the lists as tables share (#138, #236): a table is asked
 * for as a browser asks for it and read back by the reader of the foundation,
 * as an import would read it, so that a test compares the cells somebody sees.
 */

export type TableFormat = 'xlsx' | 'csv'

/** The readers of a table, over the server of a test. */
export function tableReaders(http: () => ReturnType<typeof request>) {
  /** The bytes of an answer, as a browser saves them. */
  function asked(path: string, query: Readonly<Record<string, string>>, header: string) {
    return http()
      .get(path)
      .query(query)
      .set(testIdentityHeader, header)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          done(null, Buffer.concat(chunks))
        })
      })
  }

  /** The table at the address as its rows, read by the reader of the foundation; the header first. */
  async function tableOf(
    path: string,
    query: Readonly<Record<string, string>>,
    header: string,
    format: TableFormat = 'xlsx',
  ): Promise<string[][]> {
    const answer = await asked(path, { ...query, format }, header).expect(200)
    const sheets = tableFileOf(new Uint8Array(answer.body as Buffer), `Liste.${format}`).sheets

    return sheets[0]?.rows.map((row) => [...row]) ?? []
  }

  /** The raw text of a table: the sheet of a workbook, or the file of separated values. */
  async function rawOf(
    path: string,
    query: Readonly<Record<string, string>>,
    header: string,
    format: TableFormat,
  ): Promise<string> {
    const bytes = new Uint8Array(
      (await asked(path, { ...query, format }, header).expect(200)).body as Buffer,
    )

    return format === 'csv'
      ? new TextDecoder().decode(bytes)
      : new TextDecoder().decode(
          unzip(bytes, 50_000_000).find((entry) => entry.path === 'xl/worksheets/sheet1.xml')
            ?.bytes,
        )
  }

  /** The sentence a table is refused with, and the status of the refusal. */
  async function refusalOf(
    path: string,
    query: Readonly<Record<string, string>>,
    header: string,
  ): Promise<{ readonly status: number; readonly message: string }> {
    const refused = await asked(path, { format: 'xlsx', ...query }, header)

    return {
      status: refused.status,
      message: (JSON.parse(String(refused.body)) as { message: string }).message,
    }
  }

  return { asked, tableOf, rawOf, refusalOf }
}

/** Today as a list writes a day, 11.10.2026. */
export function todayInWords(): string {
  const [year, month, day] = dayInGermany().split('-')

  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`
}

/**
 * Whatever of the stamp of the last change a table could carry: who changed
 * a record of these kinds, from which device, and the day it was changed, as
 * a list writes a day and as a program does. The kinds are the names of
 * tables of this application, never taken from a request.
 */
export async function stampsOf(
  admin: Pool,
  tenantId: string,
  kinds: readonly string[],
): Promise<string[]> {
  const { rows } = await admin.query<{ updated_by: string | null; device_id: string | null }>(
    kinds
      .map((kind) => `select updated_by, device_id from ${kind} where tenant_id = $1`)
      .join(' union '),
    [tenantId],
  )

  return [
    ...new Set(
      rows.flatMap((row) => [row.updated_by, row.device_id]).filter((value) => value !== null),
    ),
    todayInWords(),
    dayInGermany(),
  ] as string[]
}

/** The cells of a table that hold a part of the stamp, and the columns that are named for one. */
export function stampIn(rows: readonly (readonly string[])[], stamps: readonly string[]): string[] {
  const named = /geändert|gerät|updated|device|stempel/i

  return [
    ...(rows[0] ?? []).filter((column) => named.test(column)),
    ...rows.flat().filter((cell) => stamps.some((stamp) => cell.includes(stamp))),
  ]
}
