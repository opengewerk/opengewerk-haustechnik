import type { Area } from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'

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

/**
 * Whether the person holds an area, as far as the server has said: yes until
 * it has answered, so that nothing a person may do flickers away. Whoever
 * holds only the area of a building reads the property it stands on and
 * changes nothing there (#306); a screen asks this before it offers a change
 * at the property itself (#309). The server refuses such a change all the
 * same.
 */
export function useHoldsArea(areaId: unknown): boolean {
  return useHeldArea()(areaId)
}

/**
 * The same question for a list: whether the person holds an area, yes for
 * every area until the server has answered. A form that offers a property
 * itself as the place of something new offers only those whose area the
 * person holds (#310); a building, a room or an asset the device holds lies
 * in an area of the person anyway.
 */
export function useHeldArea(): (areaId: unknown) => boolean {
  const { data } = useAreasQuery()

  return useCallback(
    (areaId: unknown) => data === undefined || data.some((area) => area.id === areaId),
    [data],
  )
}

/** What a form says where the property itself is out of reach and a building is to be chosen (#310). */
export const onlyInABuilding =
  'An der Liegenschaft selbst legt nur etwas an, wer ihren Bereich hat. Wählen Sie ein Gebäude.'

/** The name of an area by its id, or nothing while the areas are not known. */
export function areaName(areas: readonly Area[], id: unknown): string | null {
  return areas.find((area) => area.id === id)?.name ?? null
}
