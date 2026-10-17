import type { QualificationKindChoice, QualificationList } from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web/office'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the qualifications of the people stand in the office (#337, 4.3 of
 * the concept): the list with the kinds, for whoever may look at them, and
 * the card under "Konto" with the own ones. Everything comes from the routes
 * of the server, with a connection.
 */
export const qualificationListPlace = {
  to: '/qualifikationen',
  label: 'Qualifikationen',
} as const satisfies Crumb

/** Every key the qualifications are read under, so that a change has all of them read again. */
export const qualificationKey = ['qualifications'] as const

export const qualificationListQuery = {
  queryKey: [...qualificationKey, 'list'],
  queryFn: () => request<QualificationList>('/qualifications'),
} as const

export const qualificationKindsQuery = {
  queryKey: [...qualificationKey, 'kinds'],
  queryFn: () => request<QualificationKindChoice[]>('/qualifications/kinds'),
} as const

/** The qualifications of the person signed in. */
export const myQualificationsQuery = {
  queryKey: [...qualificationKey, 'mine'],
  queryFn: () => request<QualificationList>('/qualifications/mine'),
} as const

/** Where the certificate of a qualification is read. */
export function certificateAddress(qualificationId: string): string {
  return `/qualifications/${encodeURIComponent(qualificationId)}/certificate`
}

/** The hash of a file, as the server holds it against its bytes. */
async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Sends a certificate ahead of the qualification and answers with its hash. */
export async function sendCertificate(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  const sha256 = await sha256Of(bytes)

  await request(`/qualifications/certificates/${sha256}`, {
    method: 'PUT',
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Media-Type': file.type === '' ? 'application/pdf' : file.type,
    },
  })

  return sha256
}
