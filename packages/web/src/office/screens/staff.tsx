import { StaffScreen as Staff } from '@opengewerk/platform-web/office'

/**
 * "Zugänge" in the office. The screen is the foundation's (ADR 0010 in the
 * repository opengewerk): who works for the tenant, with which roles and on
 * which devices, and the invitations still open.
 *
 * An invitation goes as a link to pass on: sending one by mail needs the mail
 * server of a tenant, which arrives with its mail. A new colleague works in
 * the building services more often than anything else, so the form starts
 * with that role ticked.
 */
export function StaffScreen() {
  return <Staff byMail={false} suggestedRoles={['technician']} />
}
