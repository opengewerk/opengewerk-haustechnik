import {
  syncEntities,
  tenantNameMaxLength,
  tenantNameProblem,
} from '@opengewerk/haustechnik-domain'
import type { InterfaceApplication } from '@opengewerk/platform-web'
import { directWrite, httpTransport } from '@opengewerk/platform-web/sync'

import { SyncClient } from '../sync/client.js'
import { applicationName } from './name.js'
import { records } from './records.js'

/**
 * What this application says and does where a screen of the foundation needs
 * it (ADR 0010 in the repository opengewerk): what it is called, what it says
 * of itself beside the gate, every sentence of the foundation's screens that
 * names a tenant, whoever leads one or one of the two entries, and how its
 * sync client starts.
 *
 * The words follow ADR 0001, point 11: a tenant is a "Betreiber", whoever
 * leads one is its "Leitung", and the two entries are the office ("Büro") and
 * the work on site ("Vor Ort", section 10 of the concept). Where a sentence
 * addresses the reader it does so as the screens of the foundation around it
 * do: formally before the sign in, informally behind it.
 *
 * This is what both entries share, and the entry on site hands it in as it
 * is. The office adds what only it shows (`office/application.tsx`): a phone
 * on site does not load a list of screens it never draws.
 */
export const application: InterfaceApplication = {
  name: applicationName,
  claim: 'Liegenschaft, Anlage, Pflicht, Nachweis. Die Betreiberverantwortung an einer Stelle.',
  hosting:
    'Diese Instanz läuft auf Ihrem eigenen Server. Die Daten verlassen ihn nicht, und niemand außer Ihnen kann sie abschalten.',
  licence: 'AGPL-3.0',
  tenantNameMaxLength,
  tenantNameProblem,
  // The office has them and hands them in itself; see above.
  settings: [],

  sentences: {
    signIn: {
      resetSent:
        'Wenn es zu dieser Adresse einen Zugang gibt und ein Betreiber, für den er arbeitet, E-Mails verschickt, ist ein Link zu einem neuen Passwort unterwegs.',
      resetHelp: 'Kommt keiner an, hilft die Leitung des Betreibers weiter.',
      secondFactor:
        'Für die Rolle Leitung ist der zweite Faktor Pflicht, für alle anderen empfohlen.',
    },
    secondFactor: {
      required: 'Für die Rolle Leitung ist ein zweiter Faktor Pflicht.',
      newCodes:
        'Unter "Konto" im Büro lassen sich neue erzeugen und der zweite Faktor auf einem neuen Telefon einrichten.',
    },
    tenantChoice: {
      title: 'Betreiber wählen',
      noneTitle: 'Kein Betreiber',
      none: 'Dieses Konto arbeitet für keinen Betreiber. Die Verwaltung der Instanz legt die Zugehörigkeit an.',
      notChosen: 'Der Betreiber ließ sich nicht auswählen.',
      loading: 'Die Betreiber werden geladen.',
      notLoaded: 'Die Liste der Betreiber kam nicht an.',
    },
    setup: {
      whatIsMade: 'Hier entstehen der Betreiber und das erste Konto.',
      whereTheCodeIs: 'Steht auf dem Server in der Datei docker/.env.',
      tenantLabel: 'Betreiber',
      tenantHint: 'Der Name, unter dem der Betreiber seine Gebäude führt.',
      create: 'Betreiber anlegen',
    },
    tenants: {
      switch: 'Betreiber wechseln',
    },
    settings: {
      whose: 'Dieser Betreiber',
      what: 'Was dieser Betreiber für sich festlegt.',
      belongsToTheAccount:
        'Hell oder dunkel, Passwort und zweiter Faktor gehören nicht dem Betreiber, sondern dem Konto.',
    },
    account: {
      themeElsewhere: 'Auf dem Tablet im Technikraum lässt sich unabhängig davon dunkel wählen.',
      secondFactorFor: 'Für die Rolle Leitung ist er Pflicht, für alle anderen empfohlen.',
    },
    entry: {
      name: { office: 'Büro', site: 'Vor Ort' },
      suits: {
        office: 'Das sieht nach einem Arbeitsplatz aus. Im Büro ist mehr zu sehen.',
        site: 'Das sieht nach einem Gerät für die Arbeit vor Ort aus.',
      },
      goTo: {
        office: 'Zur Büroansicht',
        site: 'Zur Ansicht für vor Ort',
      },
    },
    invitation: {
      spent: {
        redeemed:
          'Er wurde schon benutzt. Wenn das nicht Sie waren, sagen Sie der Leitung des Betreibers bitte Bescheid.',
        revoked: 'Die Leitung des Betreibers hat ihn zurückgezogen. Bitte dort nachfragen.',
        expired: 'Er ist abgelaufen. Die Leitung des Betreibers kann einen neuen erzeugen.',
      },
      tenantIsAdded: 'Sie behalten Ihr Passwort; der Betreiber kommt einfach dazu.',
      join: 'Betreiber übernehmen',
      newAccount: (name, email) => (
        <>
          Die Leitung des Betreibers hat einen Zugang für {name} angelegt, mit der Adresse {email}.
          Fehlt nur noch ein Passwort, und das wählen Sie selbst: niemand beim Betreiber bekommt es
          zu sehen.
        </>
      ),
    },
  },

  /**
   * The sync client of this application, as `sync/client.ts` binds it: with
   * the rules made from its policies and with every kind of record it has.
   * Both entries take the same way to the server.
   */
  startSync: ({ store, deviceId, onSignedOut }) =>
    SyncClient.start({
      store,
      transport: httpTransport,
      writer: directWrite,
      deviceId,
      entities: syncEntities,
      onSignedOut,
    }),

  // What the screens of the conflicts say about a record, in both entries.
  records,
}
