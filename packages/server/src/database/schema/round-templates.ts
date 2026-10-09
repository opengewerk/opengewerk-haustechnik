import { type TemplateDefinition, templateLimits } from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { trimmed } from './locations.js'

/**
 * The templates of the rounds of an operator (#112, sections 2.5 and 4.5 of
 * the concept). A template belongs to the operator and lies in no area; what
 * its points are about, assets and rooms, lies in areas, and the route asks
 * whether the person sees them.
 *
 * The title is the one of the newest version, written with it, so that the
 * list and the change log name the template. The package a template was
 * taken over from is named with the version of it, both or neither.
 *
 * The rows travel to every device, to read; the office keeps them. Nothing
 * deletes one, so the application role has no DELETE.
 */
export const roundTemplates = pgTable(
  'round_templates',
  {
    id: primaryId<'round_template'>(),
    ...tenantColumn,
    title: text('title').notNull(),
    sourceKey: text('source_key'),
    sourceVersion: integer('source_version'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('round_templates_tenant_id_key').on(table.tenantId, table.id),
    check('round_templates_title_shaped', trimmed(table.title, templateLimits.title)),
    // The key of a template of a package, `<package>.<key>`, with its version.
    check(
      'round_templates_source_shaped',
      sql`(${table.sourceKey} is null) = (${table.sourceVersion} is null) and (${table.sourceKey} is null or (${table.sourceKey} ~ '^[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$' and char_length(${table.sourceKey}) <= 130 and ${table.sourceVersion} >= 1))`,
    ),
  ],
)

/**
 * The versions of a template: what a round of it asks, as the definition of
 * a form (title and chapters with their points), and whether its evidence
 * waits for a countersignature. Counted from one per template, and never
 * changed: the application role may insert a version and read it, nothing
 * else. A round names the version it began in (`activities.form_version`).
 */
export const roundTemplateVersions = pgTable(
  'round_template_versions',
  {
    id: primaryId<'round_template_version'>(),
    ...tenantColumn,
    templateId: reference<'round_template'>('template_id').notNull(),
    formVersion: integer('form_version').notNull(),
    definition: jsonb('definition').$type<TemplateDefinition>().notNull(),
    asksCountersignature: boolean('asks_countersignature').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.templateId],
      foreignColumns: [roundTemplates.tenantId, roundTemplates.id],
      name: 'round_template_versions_of_their_template',
    }),
    unique('round_template_versions_once').on(table.tenantId, table.templateId, table.formVersion),
    check('round_template_versions_counted', sql`${table.formVersion} >= 1`),
    check(
      'round_template_versions_definition_shaped',
      sql`jsonb_typeof(${table.definition}) = 'object' and char_length(${table.definition}::text) <= ${sql.raw(String(templateLimits.definition))}`,
    ),
  ],
)
