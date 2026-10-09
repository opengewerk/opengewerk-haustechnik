import { labelCodeFromScan, type Right } from '@opengewerk/haustechnik-domain'
import type {
  AuditSentences,
  InstanceAreaSentences,
  InterfaceApplication,
  SettingsEntry,
  StaffSentences,
} from '@opengewerk/platform-web'
import { auditLogPath } from '@opengewerk/platform-web/office'
import { CalendarClock, Gauge, History, Map, ScanLine, TriangleAlert, Users } from 'lucide-react'

import { application } from '../app/application.js'
import { auditScreenWords } from './audit.js'

/**
 * The screens a tenant sets itself up with, each with the right it takes to
 * read it, in the order of the board: the areas, which are this
 * application's, who works for the tenant, which the foundation brings, the
 * defaults of the classes of defects (#116), this application's again, how
 * early and to whom each kind of deadline reminds and the change log for its
 * Leitung, both the foundation's. The right is one of this application's,
 * and the type holds that; the foundation, which draws the list, takes it as
 * a name.
 */
const settings = [
  {
    key: 'bereiche',
    to: '/einstellungen/bereiche',
    title: 'Bereiche',
    about:
      'Welche Liegenschaften zu welchem Bereich gehören. Wer einen Bereich hat, sieht nur dessen Orte.',
    icon: Map,
    right: 'settings.read',
  },
  {
    key: 'zugaenge',
    to: '/einstellungen/zugaenge',
    title: 'Zugänge',
    about:
      'Wer für diesen Betreiber arbeitet, mit welchen Rollen, Bereichen und Vertretungen, und die Einladungen.',
    icon: Users,
    right: 'membership.read',
  },
  {
    key: 'maengelklassen',
    to: '/einstellungen/maengelklassen',
    title: 'Mängelklassen',
    about: 'Welche Frist zur Beseitigung jede Klasse vorgibt. Die Klassen kommen aus den Paketen.',
    icon: TriangleAlert,
    right: 'settings.read',
  },
  {
    key: 'meters',
    to: '/einstellungen/zaehler',
    title: 'Zähler',
    about:
      'An welchem Tag im Monat der Stand jedes Zählers fällig ist. Eine Messstelle kann davon abweichen.',
    icon: Gauge,
    right: 'settings.read',
  },
  {
    key: 'fristen',
    to: '/einstellungen/fristen',
    title: 'Fristen',
    about:
      'Wie viele Tage vorher an eine fällige Pflicht und an die Frist eines Mangels erinnert wird, und wer erinnert wird.',
    icon: CalendarClock,
    right: 'deadline.read',
  },
  {
    key: 'protokoll',
    to: auditLogPath,
    title: 'Änderungsprotokoll',
    about: 'Wer wann was geändert hat, Feld für Feld, und ob das Protokoll unverändert ist.',
    icon: History,
    right: 'audit.read',
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
  noMail:
    'Per E-Mail einladen geht, sobald für diesen Betreiber ein Mailserver eingerichtet ist; bis ' +
    'dahin geht der Link von Hand hinaus.',
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
  log: {
    what: 'Jede Änderung an der Instanz. Was bei einem Betreiber geändert wird, steht in dessen Änderungsprotokoll.',
    aTenant: 'Ein Betreiber',
    operatorAppointed: 'Zur Verwaltung benannt',
    operatorRemoved: 'Aus der Verwaltung entfernt',
    tenantCreated: 'Betreiber angelegt',
    tenantRemoved: 'Betreiber entfernt',
  },
} as const satisfies InstanceAreaSentences

/**
 * What the change log of a tenant says in the words of this application:
 * what it holds, and that its Leitung reads it, as section 7 of the concept
 * gives the right to see it to the Leitung alone.
 */
const audit = {
  what: 'Jede Änderung bei diesem Betreiber, Feld für Feld: wer, wann, auf welchem Gerät und auf welchem Weg.',
  onlyFor: 'Das Änderungsprotokoll sieht nur die Leitung.',
} as const satisfies AuditSentences

/**
 * The line over the sign in for somebody who got here by scanning a label
 * (#98): what comes once signed in. Read from the address of the page, which
 * the router behind the gate keeps and opens next. It says nothing about what
 * the label hangs on: before the sign in nobody is anybody.
 */
function ScannedLabelNote() {
  if (labelCodeFromScan(globalThis.location.href) === null) {
    return null
  }

  return (
    <div
      role="note"
      className="flex max-w-[560px] items-start gap-2.5 rounded-[6px] border border-line bg-surface px-3.5 py-3 text-[15px] leading-[1.45]"
    >
      <ScanLine
        size={18}
        strokeWidth={2.2}
        aria-hidden="true"
        className="mt-px shrink-0 text-ink-muted"
      />
      <span>Sie haben ein Etikett gescannt. Nach der Anmeldung öffnet sich, wozu es gehört.</span>
    </div>
  )
}

/**
 * This application as the office hands it to the foundation: what both
 * entries share, and what only the office shows, the settings of a tenant,
 * the words of the change log, and what "Zugänge", the area of the instance
 * and the change log say (ADR 0010 in the repository opengewerk). Kept apart
 * from the shared value so that the entry on site does not load any of it. A
 * further tenant of one's own is no part of this application: a tenant is
 * made in the area of the instance.
 */
export const officeApplication: InterfaceApplication = {
  ...application,
  settings,
  audit: auditScreenWords,
  sentences: { ...application.sentences, staff, instance, audit },
  beforeSignIn: <ScannedLabelNote />,
}
