import { evidenceResults } from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { date, foreignKey, index, pgEnum, pgTable, unique } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { duties } from './duties.js'
import { properties } from './locations.js'

/** The result of a performance, from the list in `domain`. */
export const evidenceResult = pgEnum('evidence_result', evidenceResults)

/**
 * The row of an evidence as far as #25 needs it (ADR 0004, point 1): which
 * duty was met on which day, with which result. The next due day of a duty is
 * counted from it. It carries the property and the area of its duty, kept by
 * the key over the property with ON UPDATE CASCADE, and the policy
 * `within_areas` (ADR 0003).
 *
 * The application may read and add a row and nothing else: an evidence is
 * never changed and never removed (ADR 0004). The frozen state, the number,
 * the signature, corrections and invalidity, the triggers behind it and the
 * columns of the sync come with #26 and #27.
 */
export const evidence = pgTable(
  'evidence',
  {
    id: primaryId<'evidence'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    dutyId: reference<'duty'>('duty_id').notNull(),
    performedOn: date('performed_on', { mode: 'string' }).notNull(),
    result: evidenceResult('result').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('evidence_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'evidence_follows_its_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.dutyId, table.propertyId],
      foreignColumns: [duties.tenantId, duties.id, duties.propertyId],
      name: 'evidence_of_a_duty_of_its_property',
    }),
    index('evidence_duty_idx').on(table.tenantId, table.dutyId, table.performedOn),
  ],
)
