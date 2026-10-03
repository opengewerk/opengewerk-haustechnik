/**
 * Who a signature is given as (ADR 0004, points 7 and 8): the person who did
 * the work signs, and where a template asks for it the site management
 * countersigns (section 4.5 of the concept). Each has its own moment, and an
 * evidence that calls for both comes about with the second.
 */
export const signatureRoles = ['signer', 'countersigner'] as const

export type SignatureRole = (typeof signatureRoles)[number]

export const signatureRoleLabel: Readonly<Record<SignatureRole, string>> = {
  signer: 'Unterschrift',
  countersigner: 'Gegenzeichnung',
}
