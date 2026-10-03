import type { EntryIcons, EntryWords } from '@opengewerk/platform-web/tools/manifests'

import { applicationName } from '../app/name.js'

/**
 * What the two web app manifests of this application say: what each entry is
 * called and what it is for, and its icon.
 *
 * The rest of both is the foundation's (`entryManifests` in
 * `@opengewerk/platform-web/tools/manifests`, ADR 0010 in the repository
 * opengewerk): where each entry starts and how far it reaches, its colours,
 * and how the icon is offered. The build hands it these.
 *
 * The icons come from `assets/brand`, which the build serves as `/brand`: the
 * one copy of the brand files in this repository.
 */

export const icons = {
  192: '/brand/opengewerk-app-icon-192.png',
  512: '/brand/opengewerk-app-icon-512.png',
} satisfies EntryIcons

export const officeWords = {
  name: applicationName,
  short_name: 'Haustechnik',
  description:
    'Software für Betreiber von Gebäuden und ihre Haustechnik: Liegenschaften, Anlagen, Pflichten und Nachweise.',
} satisfies EntryWords

export const siteWords = {
  name: `${applicationName} Vor Ort`,
  short_name: 'Vor Ort',
  description: 'Die Arbeit vor Ort, auch ohne Netz.',
} satisfies EntryWords
