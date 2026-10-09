import {
  type Catalogue,
  type FormDefinition,
  formOfActivity,
  type RecordState,
  type RoundTemplateId,
  withTemplates,
} from '@opengewerk/haustechnik-domain'
import { count, maybeText, text, useRecord, useRecords } from '@opengewerk/platform-web/sync'

import { useCatalogue } from '../sync/catalogue.js'
import { definitionOf } from './templates.js'

/**
 * The form an activity is filled in, by its key and version, as this device
 * holds it: a round in the version of its template, which every device holds
 * (#112), every other form out of the catalogue. Null while the catalogue is
 * not there or for an activity without a form, undefined for a version this
 * device does not know.
 */
export function useFormOf(
  formKey: string | null,
  formVersion: number | null,
): FormDefinition | null | undefined {
  const catalogue = useCatalogue()
  const versions = useRecords('round_template_versions')

  if (catalogue === null) {
    return null
  }

  return formOfActivity(
    withTemplates(
      catalogue,
      versions.map((version) => ({
        templateId: text(version, 'templateId') as RoundTemplateId,
        formVersion: count(version, 'formVersion'),
        definition: definitionOf(version),
      })),
    ),
    { formKey, formVersion },
  )
}

/** The duty a point of a round fulfils, if one does (#112): its answer is the evidence of that duty. */
export function fulfilledDuty(field: object | null): string | null {
  const fulfils = (field as { readonly fulfils?: unknown } | null)?.fulfils

  return typeof fulfils === 'string' ? fulfils : null
}

/** What a duty is called: the label of its kind in the catalogue, or the one it was given. */
export function useDutyName(dutyId: string | null): string | null {
  const duty = useRecord('duties', dutyId ?? undefined)
  const catalogue = useCatalogue()

  if (dutyId === null || duty === null) {
    return null
  }

  return dutyNameOf(duty, catalogue)
}

/** What a duty this device holds is called, as `useDutyName` says it. */
export function dutyNameOf(duty: RecordState, catalogue: Catalogue | null): string | null {
  const kind = maybeText(duty, 'kind')
  const version = typeof duty['kindVersion'] === 'number' ? duty['kindVersion'] : null

  return (
    (kind === null || version === null
      ? null
      : catalogue?.dutyKindVersion(kind, version)?.definition.label) ??
    maybeText(duty, 'label') ??
    null
  )
}
