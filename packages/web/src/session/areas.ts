import type { Area } from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

/**
 * The areas the person signed in holds in, by name (section 2.8 of the
 * concept).
 *
 * Asked of the server and not read from the device: an area is no record
 * that travels, it is the line the database draws around what a person sees
 * (ADR 0003). A screen that needs the names without a connection does
 * without them and says so; the rows it shows are those of the person's
 * areas all the same, because the device holds no others.
 */
export function listAreas(): Promise<Area[]> {
  return request<Area[]>('/areas')
}

export const areasQuery = { queryKey: ['areas'], queryFn: listAreas } as const

/** The question itself, for a screen that has to wait for the answer. */
export function useAreasQuery(): UseQueryResult<Area[]> {
  return useQuery(areasQuery)
}

const none: readonly Area[] = []

/** The areas as far as they are known: none until the server has answered. */
export function useAreas(): readonly Area[] {
  return useAreasQuery().data ?? none
}

/** The name of an area by its id, or nothing while the areas are not known. */
export function areaName(areas: readonly Area[], id: unknown): string | null {
  return areas.find((area) => area.id === id)?.name ?? null
}
