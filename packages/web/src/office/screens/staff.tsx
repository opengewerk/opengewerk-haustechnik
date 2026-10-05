import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { StaffDialogsScreen } from '@opengewerk/platform-web/office'

import { useAreaAdditions } from '../staff-areas.js'
import { Substitutions } from '../substitutions.js'

/**
 * What each role is for, under its name on the card somebody picks it from
 * (section 7 of the concept, `ROLES` of the boards).
 */
export const roleNotes: Readonly<Record<RoleKey, string>> = {
  management:
    'Alles im Betreiber: Zugänge, Einstellungen, Änderungsprotokoll. Zweiter Faktor Pflicht.',
  technical_management: 'Alle Bereiche: Pflichtenverzeichnis, Katalogvorschläge, Fristen.',
  site_management:
    'Ihre Bereiche: Rundgänge planen, Aufträge verteilen und abnehmen, Anlagen pflegen.',
  technician:
    'Ihre Bereiche: Rundgänge, Aufträge und Prüfungen ausführen, Anlagen aufnehmen, Zähler ablesen, Mängel melden.',
}

export const staffScreenWords = {
  lastLead: 'Die letzte Leitung lässt sich nicht entmachten.',
  // Without "ändert die Person auch selbst unter Konto": the account screen
  // changes neither yet (opengewerk-haustechnik#128).
  correction:
    'Berichtigt die Leitung Name oder E-Mail, steht es im Änderungsprotokoll. Arbeitet das Konto ' +
    'auch für einen anderen Betreiber dieser Instanz oder gehört es zu ihrer Verwaltung, ändert ' +
    'sie nur die Person selbst.',
} as const

/**
 * "Zugänge" in the office (the boards `zugaenge`, `zugang_bearbeiten`,
 * `zugang_anlegen`, `vertretung` and `sperren`). The screen is the
 * foundation's (ADR 0010 in the repository opengewerk): who works for the
 * tenant, in which role and on which devices, and the invitations still
 * open, each made and changed in a dialog.
 *
 * This application adds what it keeps beside a membership, the areas somebody
 * holds in, as a column and as a part of both dialogs, and between the
 * accounts and the invitations the substitutions (section 2.8 of the
 * concept).
 *
 * An invitation goes as a link to pass on: sending one by mail needs the mail
 * server of a tenant, which arrives with its mail. A new colleague works in
 * the building services more often than anything else, so a new access starts
 * with that role.
 */
export function StaffScreen() {
  const areas = useAreaAdditions()

  return (
    <StaffDialogsScreen
      byMail={false}
      suggestedRole="technician"
      roleNotes={roleNotes}
      sentences={staffScreenWords}
      additions={areas}
    >
      <Substitutions />
    </StaffDialogsScreen>
  )
}
