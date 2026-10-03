import type { Right } from '@opengewerk/haustechnik-domain'
import type {
  InstanceAreaSentences,
  InterfaceApplication,
  SettingsEntry,
  StaffSentences,
} from '@opengewerk/platform-web'
import { Users } from 'lucide-react'

import { application } from '../app/application.js'

/**
 * The screens a tenant sets itself up with, each with the right it takes to
 * read it. So far the one the foundation brings: who works for the tenant.
 * The right is one of this application's, and the type holds that; the
 * foundation, which draws the list, takes it as a name.
 */
const settings = [
  {
    key: 'zugaenge',
    to: '/einstellungen/zugaenge',
    title: 'Zugänge',
    about: 'Wer für diesen Betreiber arbeitet, mit welchen Rollen, und die Einladungen.',
    icon: Users,
    right: 'membership.read',
  },
] as const satisfies readonly (SettingsEntry & { readonly right: Right })[]

/**
 * What "Zugänge" says in the words of this application: its word for a
 * tenant, and that an invitation goes as a link until a mail server is set
 * up, which arrives with the mail of a tenant.
 */
const staff = {
  what: 'Wer für diesen Betreiber arbeitet, und womit.',
  accounts: 'Konten dieses Betreibers',
  noMail: 'Per E-Mail einladen geht, sobald für diesen Betreiber ein Mailserver eingerichtet ist.',
  mailedLinkUnseen: 'im Büro sieht ihn niemand.',
  noDevices: 'Bei diesem Betreiber ist gerade kein Gerät angemeldet.',
  devicesOf: (name) => `Geräte, auf denen ${name} bei diesem Betreiber angemeldet ist`,
} as const satisfies StaffSentences

/**
 * What the area of the instance says in the words of this application: a
 * tenant is a "Betreiber", whoever leads one its "Leitung", and whoever runs
 * the instance the "Verwaltung der Instanz", never "Betreiber der Instanz"
 * (ADR 0001, point 11).
 */
const instance = {
  what: 'Was allen Betreibern auf dieser Instanz gemeinsam ist.',
  shut: 'Diesen Bereich erreicht nur die Verwaltung der Instanz.',
  notAsked: 'Ob du zur Verwaltung dieser Instanz gehörst, ließ sich gerade nicht erfragen.',
  secondFactor: 'Für diesen Bereich ist ein zweiter Faktor Pflicht, wie für die Rolle Leitung',
  back: 'Zurück zum Büro',
  tenants: {
    title: 'Betreiber',
    what: 'Die Betreiber auf dieser Instanz. Jeder ist vom anderen getrennt wie zwei fremde.',
    create: 'Betreiber anlegen',
    caption: 'Die Betreiber auf dieser Instanz',
    note: 'Was bei einem Betreiber steht, sieht hier niemand, auch die Verwaltung der Instanz nicht: nur sein Name, der Tag der Anlage und wer ihn leitet.',
    tenantColumn: 'Betreiber',
    leadsColumn: 'Leitung',
    nameLabel: 'Name des Betreibers',
    leadNameLabel: 'Name der Leitung',
    leadNameMissing: 'Der Name der Leitung fehlt.',
    leadEmailLabel: 'E-Mail der Leitung',
    leadEmailHint:
      'Der Link macht die Person zur Leitung. Hat sie schon ein Konto auf dieser Instanz, meldet sie sich damit an.',
    forOneself:
      'Wer einen Betreiber für sich selbst anlegt, trägt hier die eigene Adresse ein und öffnet den Link selbst.',
    notCreated: 'Der Betreiber ließ sich nicht anlegen.',
    linkMakes: 'wer ihn öffnet, wird Leitung des neuen Betreibers.',
  },
  operators: {
    title: 'Verwaltung der Instanz',
    caption: 'Die Konten der Verwaltung dieser Instanz',
    column: 'Konto',
    whoStays: 'Sich selbst und das letzte Konto der Verwaltung entfernt niemand.',
    remove: (name) => `${name} aus der Verwaltung entfernen`,
    whatStays:
      'Das Konto bleibt, ebenso seine Zugänge zu Betreibern; nur dieser Bereich ist danach zu.',
    notRemoved: 'Das Konto ließ sich nicht aus der Verwaltung entfernen.',
    appoint: 'Zur Verwaltung benennen',
    appointing:
      'Zur Verwaltung kommt ein Konto, das es auf dieser Instanz schon gibt. Es verwaltet dann, was allen Betreibern gemeinsam ist, und sieht die Liste der Betreiber, aber nichts, was bei einem steht.',
    exampleAddress: 'name@betreiber.de',
    appointed: (name) => `${name} gehört jetzt zur Verwaltung der Instanz.`,
  },
  settings: {
    what: 'Was für alle Betreiber auf dieser Instanz gilt.',
    mailOwnServer: 'Ein Betreiber verschickt seine E-Mails über seinen eigenen Mailserver.',
    mailNoWayIn: 'So greift kein Betreiber über die Instanz in das Netz dahinter.',
  },
} as const satisfies InstanceAreaSentences

/**
 * This application as the office hands it to the foundation: what both
 * entries share, and what only the office shows, the settings of a tenant and
 * what "Zugänge" and the area of the instance say (ADR 0010 in the
 * repository opengewerk). Kept apart from the shared value so that the entry
 * on site does not load any of it. A further tenant of one's own is no part
 * of this application: a tenant is made in the area of the instance.
 */
export const officeApplication: InterfaceApplication = {
  ...application,
  settings,
  sentences: { ...application.sentences, staff, instance },
}
