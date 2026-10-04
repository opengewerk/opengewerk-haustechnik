import type { Right } from '@opengewerk/haustechnik-domain'
import { useRights } from '@opengewerk/platform-web/session'
import { useRouter } from '@tanstack/react-router'

/**
 * What a place in the navigation of the office or among the tabs on site
 * asks before it stands there: a screen at its address, and the right to see
 * what is behind it.
 */
export interface Offer {
  /** The address of the screen the place leads to. */
  readonly to: string
  /**
   * The right it takes to see what is behind the place (section 7 of the
   * concept). Without one the place is for everybody who is signed in.
   */
  readonly right?: Right
}

/**
 * The places somebody is offered: those whose screen is built and whose right
 * the person holds, in their order.
 *
 * A courtesy and not the gate: the routes behind every screen ask the
 * membership on every request, and the database draws the line of the areas.
 */
export function offered<Place extends Offer>(
  places: readonly Place[],
  held: readonly string[],
  built: (to: string) => boolean,
): readonly Place[] {
  return places.filter(
    (place) => built(place.to) && (place.right === undefined || held.includes(place.right)),
  )
}

/** What the router keeps of a route, as far as it is asked here. */
interface KnownRoute {
  readonly options: { readonly component?: unknown }
  /** Set for a route whose screen is loaded when it is first opened. */
  readonly lazyFn?: unknown
}

/**
 * Whether a screen answers at an address of this entry: a route with
 * something to show there, and not one that only leads on, as the start of an
 * entry does until its own screen is built.
 *
 * This is how a place appears with the first screen behind it (#83). The
 * boards draw the whole navigation, and this application writes all of it
 * down once; the pull request that builds a screen adds its route and nothing
 * to the navigation.
 */
export function useBuilt(): (to: string) => boolean {
  const routes = useRouter().routesByPath as Readonly<Record<string, KnownRoute | undefined>>

  return (to) => {
    const route = routes[to]

    return route !== undefined && (route.options.component !== undefined || route.lazyFn != null)
  }
}

/** Of the places an entry has, those offered to the person signed in. */
export function useOffered<Place extends Offer>(places: readonly Place[]): readonly Place[] {
  return offered(places, useRights(), useBuilt())
}
