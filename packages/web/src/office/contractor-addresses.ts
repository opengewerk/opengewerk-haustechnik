import type {
  ContractorEntry,
  ContractorName,
  ContractorPage,
} from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the contractors of the operator stand in the office (#328, 4.11 of
 * the concept): the list with the names to take over, and the page of one
 * firm. Everything comes from the routes of the server, with a connection.
 */
export const contractorPlaces = {
  list: '/fremdfirmen',
  contractor: (contractorId: string) => `/fremdfirmen/${contractorId}`,
} as const

/** Every key the contractors are read under, so that a change has all of them read again. */
export const contractorKey = ['contractors'] as const

export const contractorListQuery = {
  queryKey: [...contractorKey, 'list'],
  queryFn: () => request<ContractorEntry[]>('/contractors'),
} as const

export const contractorNamesQuery = {
  queryKey: [...contractorKey, 'names'],
  queryFn: () => request<ContractorName[]>('/contractors/names'),
} as const

export function contractorQuery(contractorId: string) {
  return {
    queryKey: [...contractorKey, 'page', contractorId],
    queryFn: () => request<ContractorPage>(`/contractors/${encodeURIComponent(contractorId)}`),
  } as const
}
