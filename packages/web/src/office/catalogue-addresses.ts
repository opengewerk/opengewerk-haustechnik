import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the catalogue lives in the office: the packages at `/katalog`, a
 * package with one of its parts under its name, and a duty kind under the
 * package it comes from. In one place, so that the register of duties, a
 * proposal and the file of an asset link to an entry the way the catalogue
 * itself does.
 */

/** The parts of a package, in the order of the board, each with what the address calls it. */
export const catalogueParts = [
  { address: 'pflichtarten', label: 'Pflichtarten' },
  { address: 'anlagenarten', label: 'Anlagenarten' },
  { address: 'formulare', label: 'Formulare' },
  { address: 'regeln', label: 'Regeln' },
  { address: 'vorlagen', label: 'Vorlagen' },
] as const

export type CataloguePart = (typeof catalogueParts)[number]['address']

export function isCataloguePart(address: string | undefined): address is CataloguePart {
  return catalogueParts.some((part) => part.address === address)
}

const root = '/katalog'

/**
 * A key outside its package is `<package>.<key>`, and neither half has a
 * point of its own (ADR 0005).
 */
function halves(key: string): readonly [string, string] {
  const at = key.indexOf('.')

  return [key.slice(0, at), key.slice(at + 1)]
}

export const cataloguePlaces = {
  list: { to: root, label: 'Katalog' } satisfies Crumb,
  package: (name: string): string => `${root}/${encodeURIComponent(name)}`,
  part: (name: string, part: CataloguePart): string =>
    `${root}/${encodeURIComponent(name)}/${part}`,
  /** The page of a duty kind, by the key everything outside its package names it by. */
  dutyKind: (key: string): string => {
    const [name, own] = halves(key)

    return `${root}/${encodeURIComponent(name)}/pflichtarten/${encodeURIComponent(own)}`
  },
} as const
