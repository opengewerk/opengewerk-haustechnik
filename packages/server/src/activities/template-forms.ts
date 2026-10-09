import { type FormVersions, templateOfFormKey, withTemplates } from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'

import { roundTemplateVersions } from '../database/schema/index.js'

/**
 * Where the form of an activity is found (#112): a form of a package in the
 * catalogue, the template of a round in its version, which is read here for
 * the one activity. The version a round names is never changed, so what it
 * was filled in is what it is signed and written down with.
 */
export async function formsFor(
  tx: TenantTransaction,
  catalogue: FormVersions,
  activity: { readonly formKey: string | null; readonly formVersion: number | null },
): Promise<FormVersions> {
  const template = activity.formKey === null ? null : templateOfFormKey(activity.formKey)

  if (template === null || activity.formVersion === null) {
    return catalogue
  }

  const versions = await tx
    .select()
    .from(roundTemplateVersions)
    .where(
      and(
        eq(roundTemplateVersions.templateId, template),
        eq(roundTemplateVersions.formVersion, activity.formVersion),
      ),
    )

  return withTemplates(catalogue, versions)
}
