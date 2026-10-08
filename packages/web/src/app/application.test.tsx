import 'fake-indexeddb/auto'

import type { TenantChoice, TenantId } from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import {
  SecondFactorSetupScreen,
  SetupScreen,
  SignInScreen,
  TenantScreen,
} from '@opengewerk/platform-web/gate'
import { SettingsScreen } from '@opengewerk/platform-web/office'
import { useWho } from '@opengewerk/platform-web/session'
import { EntrySuggestion } from '@opengewerk/platform-web/shell'
import { InRouter } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { officeApplication } from '../office/application.js'
import officeEntry from '../office/main.tsx?raw'
import siteEntry from '../site/main.tsx?raw'
import { application } from './application.js'

/**
 * What this application says where the foundation draws the screen (ADR 0010
 * in the repository opengewerk).
 *
 * The gate before the first screen is the foundation's and is tested there,
 * with an application that belongs to nobody. What is held here is the
 * binding: that in this application a tenant is a "Betreiber", whoever leads
 * one its "Leitung", and the entry for the work on site "Vor Ort" (ADR 0001,
 * point 11), in every sentence a person reads before and around the first
 * screen.
 */

let answers: Map<string, { readonly status: number; readonly body: unknown } | 'down'>

function inApplication(node: ReactNode) {
  // A client per test, so that one test's answers are not another's cache.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <ApplicationProvider application={officeApplication}>{node}</ApplicationProvider>
    </QueryClientProvider>
  )
}

/**
 * The name of the tenant one works in, once the answer is there that also
 * carries the rights: what a test waits for before it says a screen is not
 * offered, since nothing is offered while nobody knows the rights yet.
 */
function TenantName() {
  const { tenant } = useWho()

  return tenant ? <p>{tenant}</p> : null
}

/** A tenant of the account, as `GET /auth/tenants` lists it for somebody who leads it. */
const nord: TenantChoice = {
  id: 't-nord' as TenantId,
  name: 'Gebäudeverwaltung Nord',
  roles: ['management'],
  roleLabels: ['Leitung'],
  rights: ['membership.read', 'membership.write', 'audit.read'],
  secondFactor: true,
}

beforeEach(() => {
  answers = new Map()

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const answer = answers.get(`${init?.method ?? 'GET'} ${path}`) ?? { status: 200, body: {} }

    if (answer === 'down') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the gate of this application', () => {
  it('says beside the card what it is, where it runs and under which licence', () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    expect(screen.getByRole('complementary').textContent).toBe(
      'OpenGewerk Haustechnik' +
        'Liegenschaft, Anlage, Pflicht, Nachweis. Die Betreiberverantwortung an einer Stelle.' +
        'Diese Instanz läuft auf Ihrem eigenen Server. Die Daten verlassen ihn nicht, und niemand außer Ihnen kann sie abschalten.' +
        'AGPL-3.0',
    )
  })

  it('says under the sign in that the role Leitung needs a second factor', () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    expect(
      screen.getByText(
        /^Für die Rolle Leitung ist der zweite Faktor Pflicht, für alle anderen empfohlen\./,
      ),
    ).toBeTruthy()
  })

  it('says after a forgotten password that the Leitung of the tenant helps', async () => {
    render(inApplication(<SignInScreen onSignedIn={vi.fn()} onSecondFactor={vi.fn()} />))

    await userEvent.type(screen.getByLabelText('E-Mail'), 'technik@nord.example.de')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    const said = (await screen.findByRole('status')).textContent ?? ''

    expect(said.startsWith('Wenn es zu dieser Adresse einen Zugang gibt und ein Betreiber')).toBe(
      true,
    )
    expect(said.endsWith('Kommt keiner an, hilft die Leitung des Betreibers weiter.')).toBe(true)
  })

  it('says over the setup of a second factor that the Leitung has to have one', () => {
    render(inApplication(<SecondFactorSetupScreen onDone={vi.fn()} />))

    expect(
      screen.getByText(/^Für die Rolle Leitung ist ein zweiter Faktor Pflicht\. Richten Sie/),
    ).toBeTruthy()
  })

  it('calls what is chosen a Betreiber: in the heading, for an account without one, and when one could not be chosen', async () => {
    const first = render(
      inApplication(
        <TenantScreen
          entry="office"
          deviceId="geraet"
          tenants={[]}
          onChosen={vi.fn()}
          onSignedOut={vi.fn()}
        />,
      ),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Kein Betreiber' })).toBeTruthy()
    expect(
      screen.getByText(
        'Dieses Konto arbeitet für keinen Betreiber. Die Verwaltung der Instanz legt die Zugehörigkeit an.',
      ),
    ).toBeTruthy()
    first.unmount()

    answers.set('POST /auth/tenant', 'down')
    render(
      inApplication(
        <TenantScreen
          entry="office"
          deviceId="geraet"
          tenants={[nord]}
          onChosen={vi.fn()}
          onSignedOut={vi.fn()}
        />,
      ),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Betreiber wählen' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Gebäudeverwaltung Nord/ }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Betreiber ließ sich nicht auswählen.',
    )
  })

  /**
   * The setup code stands where the setup of the installation writes it, and
   * the name stops where the server would refuse it: 120 characters, the
   * limit `tenantNameProblem` holds.
   */
  it('sets up a Betreiber at the first run, and says where the setup code stands', () => {
    render(inApplication(<SetupScreen onDone={vi.fn()} />))

    expect(screen.getByText(/Hier entstehen der Betreiber und das erste Konto\./)).toBeTruthy()
    expect(screen.getByText(/^Steht auf dem Server in der Datei docker\/\.env\./)).toBeTruthy()

    const tenant = screen.getByLabelText('Betreiber') as HTMLInputElement

    expect(tenant.maxLength).toBe(120)
    expect(screen.getByText('Der Name, unter dem der Betreiber seine Gebäude führt.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Betreiber anlegen' })).toBeTruthy()
  })
})

describe('what each entry hands to the foundation', () => {
  /**
   * The entry on site never shows a settings screen, "Zugänge" or the area of
   * the instance, and a phone should not load any of them. So the office adds
   * them to what the entries share, and the entry on site hands in the shared
   * value as it is.
   */
  it('is the same application, with the settings of a Betreiber only from the office', () => {
    expect(application.settings).toEqual([])
    expect(officeApplication.settings.map((entry) => entry.key)).toEqual([
      'bereiche',
      'zugaenge',
      'fristen',
      'protokoll',
    ])
    expect(application.ownTenant).toBeUndefined()
    expect(officeApplication.ownTenant).toBeUndefined()
    expect(application.sentences.staff).toBeUndefined()
    expect(application.sentences.instance).toBeUndefined()
    expect(officeApplication.sentences.staff?.accounts).toBe('Konten dieses Betreibers')
    expect(officeApplication.sentences.instance?.tenants.title).toBe('Betreiber')
    expect(officeApplication.sentences.instance?.operators.title).toBe('Verwaltung der Instanz')
    expect(officeApplication.sentences.instance?.log.tenantCreated).toBe('Betreiber angelegt')
    // The change log is the Leitung's, and its words come only with the office.
    expect(application.audit).toBeUndefined()
    expect(application.sentences.audit).toBeUndefined()
    expect(officeApplication.sentences.audit?.onlyFor).toBe(
      'Das Änderungsprotokoll sieht nur die Leitung.',
    )
    expect(officeApplication.audit?.vocabulary.foundation.tenant).toBe('Betreiber')

    // The address on a label is one of the office: the line over its sign in
    // for whoever scanned one comes only with the office (#98).
    expect(application.beforeSignIn).toBeUndefined()
    expect(officeApplication.beforeSignIn).toBeDefined()

    const {
      audit: _audit,
      beforeSignIn: _beforeSignIn,
      sentences: { staff: _staff, instance: _instance, audit: _log, ...sentences },
      ...shared
    } = officeApplication

    expect({ ...shared, sentences, settings: [] }).toEqual(application)
  })

  /**
   * Which of the two an entry hands in is one line of its `main.tsx`, and no
   * test renders that file: it mounts into the page and starts the service
   * worker. Both mistakes would pass every other test, so the line is read.
   */
  it('is handed in by the entry itself, the office its own and the entry on site the shared one', () => {
    expect(officeEntry).toContain('<Root entry="office" application={officeApplication}>')
    expect(siteEntry).toContain('<Root entry="site" application={application}>')
  })
})

describe('the two entries of this application', () => {
  /** A device with only a finger, or with a mouse: happy-dom answers no to every query. */
  function device(coarse: boolean, fine: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)' ? coarse : query === '(any-pointer: fine)' && fine,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }

  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('are the office and the work on site, and a phone in the office is offered the second', () => {
    device(true, false)
    render(inApplication(<EntrySuggestion here="office" />))

    expect(screen.getByText('Das sieht nach einem Gerät für die Arbeit vor Ort aus.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zur Ansicht für vor Ort' }).getAttribute('href')).toBe(
      '/m/',
    )
  })

  it('offer a desk on site the office', () => {
    device(false, true)
    render(inApplication(<EntrySuggestion here="site" />))

    expect(
      screen.getByText('Das sieht nach einem Arbeitsplatz aus. Im Büro ist mehr zu sehen.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zur Büroansicht' }).getAttribute('href')).toBe('/')
  })
})

describe('the settings of a Betreiber', () => {
  it('are called the Betreiber’s on the overview, with "Zugänge" and the change log for whoever leads it', async () => {
    answers.set('GET /api/auth/get-session', {
      status: 200,
      body: {
        user: { id: 'u-1', email: 'leitung@nord.example.de', name: 'Lea Leitung' },
        session: { activeTenantId: 't-nord' },
      },
    })
    answers.set('GET /auth/tenants', { status: 200, body: [nord] })

    render(
      inApplication(
        <InRouter at="/einstellungen">
          <SettingsScreen />
        </InRouter>,
      ),
    )

    expect(await screen.findByText('Was dieser Betreiber für sich festlegt.')).toBeTruthy()
    expect(
      screen.getByText(
        /^Hell oder dunkel, Passwort und zweiter Faktor gehören nicht dem Betreiber, sondern dem Konto\./,
      ),
    ).toBeTruthy()
    expect(
      await screen.findByText(
        'Wer für diesen Betreiber arbeitet, mit welchen Rollen, Bereichen und Vertretungen, und die Einladungen.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Wer wann was geändert hat, Feld für Feld, und ob das Protokoll unverändert ist.',
      ),
    ).toBeTruthy()
  })

  it('leave the change log out for whoever may not read it', async () => {
    answers.set('GET /api/auth/get-session', {
      status: 200,
      body: {
        user: { id: 'u-2', email: 'objekt@nord.example.de', name: 'Ole Objektleitung' },
        session: { activeTenantId: 't-nord' },
      },
    })
    answers.set('GET /auth/tenants', {
      status: 200,
      body: [{ ...nord, roles: ['site_management'], roleLabels: ['Objektleitung'], rights: [] }],
    })

    render(
      inApplication(
        <InRouter at="/einstellungen">
          <TenantName />
          <SettingsScreen />
        </InRouter>,
      ),
    )

    expect(await screen.findByText('Gebäudeverwaltung Nord')).toBeTruthy()
    expect(screen.queryByText('Änderungsprotokoll')).toBeNull()
    expect(screen.queryByText('Zugänge')).toBeNull()
  })
})
