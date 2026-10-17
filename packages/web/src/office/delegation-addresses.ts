import type { DelegationEntry, DelegationReading } from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web/office'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the delegations of the operator's duties stand in the office (#336,
 * 4.3 of the concept): the list and the page of one, for the Leitung, and
 * the card under "Konto" for the person a delegation goes to. Everything
 * comes from the routes of the server, with a connection.
 */
export const delegationListPlace = {
  to: '/pflichtenuebertragungen',
  label: 'Pflichtenübertragungen',
} as const satisfies Crumb

export const delegationPlaces = {
  list: delegationListPlace.to,
  delegation: (delegationId: string) => `${delegationListPlace.to}/${delegationId}`,
} as const

/** Every key the delegations are read under, so that a change has all of them read again. */
export const delegationKey = ['delegations'] as const

/** The list, with how many duties in the areas of the person have nobody, or somebody without a delegation. */
export interface DelegationList {
  readonly delegations: readonly DelegationEntry[]
  readonly duties: { readonly withoutResponsible: number; readonly withoutDelegation: number }
}

export const delegationListQuery = {
  queryKey: [...delegationKey, 'list'],
  queryFn: () => request<DelegationList>('/delegations'),
} as const

/** The delegations to the person signed in, from the signature of the Leitung on. */
export const myDelegationsQuery = {
  queryKey: [...delegationKey, 'mine'],
  queryFn: () => request<DelegationEntry[]>('/delegations/mine'),
} as const

export function delegationQuery(delegationId: string) {
  return {
    queryKey: [...delegationKey, 'page', delegationId],
    queryFn: () => request<DelegationReading>(`/delegations/${delegationId}`),
  } as const
}

/** Where the PDF of a delegation is read: the copy of the person, and the page of the Leitung. */
export function delegationPdf(delegationId: string): string {
  return `/delegations/${delegationId}/pdf`
}
