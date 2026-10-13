import type { HelpLink, HelpSource } from '@opengewerk/platform-web/office'
import { accountQuery, instanceAccessQuery } from '@opengewerk/platform-web/session'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, List } from 'lucide-react'
import { useMemo } from 'react'

import { officeFoot, officeNavigation } from './navigation.js'

/**
 * The help of the office (#131): which text belongs to which address, and
 * where the drawer leads beyond the screen. The button, its entry behind
 * "Menü" and the drawer are the foundation's (ADR 0010 in the repository
 * opengewerk); the texts are this application's and lie as Markdown under
 * `packages/web/help/office`, each named after the address it belongs to.
 */

/** Where the quick guides stand in the office, and the manual in the area of the instance. */
export const helpPlace = '/hilfe'
export const manualPlace = '/instanz/handbuch'

/** The name a text is kept under: the address without its first slash, and `index` for the first screen. */
export function helpKeyOf(address: string): string {
  const path = address.replace(/^\/+|\/+$/g, '')

  return path === '' ? 'index' : path
}

/**
 * A record below a list that has a text of its own, because more happens on
 * it than the text of its list can say. `not` are the words after the list
 * that are no record: the form a new one is made with.
 */
const records: readonly {
  readonly under: string
  readonly not: readonly string[]
  readonly key: string
}[] = [{ under: '/anlagen/', not: ['neu'], key: 'anlagen/akte' }]

/**
 * The text of an address, by its name: the one of the address itself, or of
 * what it lies below, so that the form of a plan reads the text of the
 * rounds. A place that keeps its records at an address of their own, as the
 * properties do their buildings, lends them its text (`also` of the
 * navigation). An address none of this finds a text for has none, and the
 * drawer says so; the first screen lends its text to nothing.
 */
export function officeHelpKey(pathname: string, has: (key: string) => boolean): string | null {
  const segments = pathname.split('/').filter(Boolean)
  const path = `/${segments.join('/')}`

  if (segments.length === 0) {
    return has('index') ? 'index' : null
  }

  for (const record of records) {
    const [first] = path.startsWith(record.under) ? path.slice(record.under.length).split('/') : []

    if (first !== undefined && first !== '' && !record.not.includes(first) && has(record.key)) {
      return record.key
    }
  }

  for (let length = segments.length; length > 0; length -= 1) {
    const key = segments.slice(0, length).join('/')

    if (has(key)) {
      return key
    }
  }

  const place = [...officeNavigation.flatMap((group) => group.entries), ...officeFoot].find(
    (entry) => entry.also?.some((root) => path === root || path.startsWith(`${root}/`)) === true,
  )
  const lent = place === undefined ? null : helpKeyOf(place.to)

  return lent !== null && has(lent) ? lent : null
}

const guides: HelpLink = { to: helpPlace, label: 'Kurzanleitungen', icon: List }
const manual: HelpLink = { to: manualPlace, label: 'Handbuch öffnen', icon: BookOpen }

/**
 * The help as the frame of the office asks it. The texts are loaded when the
 * drawer is opened for the first time. The manual is about running the
 * instance, so the way to it stands for whoever runs it, as the area of the
 * instance does in the menu of the person.
 */
export function useOfficeHelp(): HelpSource {
  const account = useQuery(accountQuery)
  const access = useQuery({ ...instanceAccessQuery, enabled: Boolean(account.data) })
  const runsInstance = access.data?.operator === true

  return useMemo(
    () => ({
      textAt: async (pathname: string) => {
        const { officeTexts } = await import('../help/office-texts.js')
        const key = officeHelpKey(pathname, (name) => officeTexts.has(name))

        return key === null ? null : (officeTexts.get(key) ?? null)
      },
      more: runsInstance ? [manual, guides] : [guides],
    }),
    [runsInstance],
  )
}
