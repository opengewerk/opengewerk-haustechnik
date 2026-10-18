import { offerableRights, type RoleEntry, type RoleKey } from '@opengewerk/haustechnik-domain'
import { StaffDialogsScreen } from '@opengewerk/platform-web/office'
import { mailStatus, useRight } from '@opengewerk/platform-web/session'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'

import { AuditorReadsCard } from '../auditor-reads.js'
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
  reporter:
    'Ihre Bereiche: Störungen melden und die eigenen Meldungen sehen, sonst nichts. Arbeitet vor Ort mit Verbindung.',
  // The auditor from outside (#339, section 4.3 of the concept).
  auditor:
    'Von außen und nur lesend: Pflichten, Nachweise und Prüfbescheinigungen, bis zum letzten Tag. Jeder Zugriff wird festgehalten.',
}

/** What a role of the tenant's own is for, under its name on the card (#346): its rights, and a second factor where it asks for one. */
export function ownRoleNote(role: Pick<RoleEntry, 'rights' | 'secondFactor'>): string {
  const held = offerableRights.filter((right) => role.rights.includes(right)).length

  return `Eigene Rolle dieses Betreibers, ${String(held)} ${held === 1 ? 'Recht' : 'Rechte'}.${role.secondFactor ? ' Zweiter Faktor Pflicht.' : ''}`
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
 * Whether the tenant sends mail is asked at the route of its mail settings
 * (#126): with a mail server an invitation can go out by mail instead of as a
 * link to pass on. A new colleague works in
 * the building services more often than anything else, so a new access starts
 * with that role.
 */
export function StaffScreen() {
  const areas = useAreaAdditions()
  const mail = useQuery({ queryKey: ['mail-status'], queryFn: mailStatus })
  // The roles the tenant made for itself say what they are under their names (#346).
  const readsRoles = useRight('membership.read')
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => request<readonly RoleEntry[]>('/roles'),
    enabled: readsRoles,
  })
  const notes: Readonly<Record<string, string>> = {
    ...Object.fromEntries(
      (roles.data ?? [])
        .filter((role) => !role.shipped)
        .map((role) => [role.key, ownRoleNote(role)] as const),
    ),
    ...roleNotes,
  }

  return (
    <StaffDialogsScreen
      byMail={mail.data?.configured === true}
      suggestedRole="technician"
      roleNotes={notes}
      sentences={staffScreenWords}
      additions={areas}
      // An auditor from outside is given an access only up to a last day (#339).
      endingRoles={['auditor']}
    >
      <Substitutions />
      <AuditorReadsCard />
    </StaffDialogsScreen>
  )
}
