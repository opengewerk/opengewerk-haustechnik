import {
  deadlineKinds,
  type ProcessingFacts,
  type Right,
  rights,
} from '@opengewerk/haustechnik-domain'
import { deadlineSettingsOf, type TenantTransaction } from '@opengewerk/platform-server'
import { mailSettings } from '@opengewerk/platform-server/schema'

import { workOrderSettingsOf } from '../activities/service-reports.js'
import { recordRetentionOf } from '../api/record-retention.controller.js'
import { minimumYearsOf } from '../api/retention.controller.js'
import { rolesOf } from '../api/roles.controller.js'
import { faultReportSettingsOf } from '../faults/reading.js'
import { removalDaysOf } from '../memberships/end.js'

// What the description of the processing says about one operator (#357):
// read from the settings it has, each by the function its own screen reads
// it with, so that the description says what the screen says.

/** The settings of the operator of the transaction that concern the people who work for it. */
export async function processingFactsOf(tx: TenantTransaction): Promise<ProcessingFacts> {
  const roles = await rolesOf(tx)
  const reminders = await deadlineSettingsOf(tx)
  const [mailServer] = await tx.select({ id: mailSettings.id }).from(mailSettings).limit(1)
  const known = (right: string): right is Right => (rights as readonly string[]).includes(right)

  return {
    roles: roles.map((role) => ({
      label: role.label,
      shipped: role.shipped,
      holders: role.holders,
      rights: role.rights.filter(known),
      secondFactor: role.secondFactor,
    })),
    namesAndTimes: (await workOrderSettingsOf(tx)).namesAndTimes,
    openByLabel: (await faultReportSettingsOf(tx)).openByLabel,
    minimumYears: await minimumYearsOf(tx),
    recordYears: await recordRetentionOf(tx),
    removalDays: await removalDaysOf(tx),
    mailServer: mailServer !== undefined,
    reminders: deadlineKinds.map((kind) => {
      const set = reminders.get(kind.key)

      return {
        kind: kind.title,
        leadDays: set?.leadDays ?? kind.leadDays,
        reminder: set?.reminder ?? 'email_and_push',
      }
    }),
  }
}
