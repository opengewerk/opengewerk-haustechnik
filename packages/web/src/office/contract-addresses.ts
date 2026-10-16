import type {
  AssetContract,
  ContractEntry,
  ContractPage,
  OrderWarranty,
} from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the contracts of the operator stand in the office (#329, 4.11 of the
 * concept): the list, and the page of one contract. Everything comes from the
 * routes of the server, with a connection.
 */
export const contractPlaces = {
  list: '/vertraege',
  contract: (contractId: string) => `/vertraege/${contractId}`,
} as const

/** Every key the contracts are read under, so that a change has all of them read again. */
export const contractKey = ['contracts'] as const

export const contractListQuery = {
  queryKey: [...contractKey, 'list'],
  queryFn: () => request<ContractEntry[]>('/contracts'),
} as const

/** The live contracts of one firm, for the choice at a duty. */
export function firmContractsQuery(contractorId: string) {
  return {
    queryKey: [...contractKey, 'of-firm', contractorId],
    queryFn: () =>
      request<ContractEntry[]>(`/contracts?contractorId=${encodeURIComponent(contractorId)}`),
  } as const
}

export function contractQuery(contractId: string) {
  return {
    queryKey: [...contractKey, 'page', contractId],
    queryFn: () => request<ContractPage>(`/contracts/${encodeURIComponent(contractId)}`),
  } as const
}

/** The contracts that cover an asset, itself or through its building. */
export function assetContractsQuery(assetId: string) {
  return {
    queryKey: [...contractKey, 'at-asset', assetId],
    queryFn: () => request<AssetContract[]>(`/contracts/at-asset/${encodeURIComponent(assetId)}`),
  } as const
}

/** The accepted work orders at an asset with a warranty of their own. */
export function orderWarrantiesQuery(assetId: string) {
  return {
    queryKey: [...contractKey, 'order-warranties', assetId],
    queryFn: () =>
      request<OrderWarranty[]>(`/work-orders/warranties?assetId=${encodeURIComponent(assetId)}`),
  } as const
}
