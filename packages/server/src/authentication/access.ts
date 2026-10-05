import {
  applicationRights,
  type Right,
  type RoleKey,
  shippedRoles,
  tenantNameProblem,
} from '@opengewerk/haustechnik-domain'
import {
  type AccessRules,
  addStaffMember as addMember,
  type Authentication,
  type AuthenticationOptions,
  createAuthentication as createFor,
  type Database,
  type FirstRun,
  type FirstRunResult,
  SessionIdentitySource as SessionIdentities,
  setUpInstance as setUp,
  type StaffMember as Member,
} from '@opengewerk/platform-server'

import { areaAdditions } from '../areas/additions.js'
import { application } from '../configuration.js'

// The authentication is the foundation's (ADR 0010 in the repository
// opengewerk): accounts, sessions, the second factor and passkeys, the first
// run, the one time link, who works for a tenant and the roles of a tenant as
// rows. What it cannot know is which rights this application has, which roles
// a tenant starts with, and what a tenant and whoever leads it are called.
// This is where it is told, and where what needs telling is bound, so that the
// rest of the server asks one module and gets the rights and the roles of
// this application.
//
// The words follow ADR 0001, point 11, and ADR 0002, point 19: a tenant is a
// "Betreiber", whoever leads one is its "Leitung", and whoever runs the
// instance is the "Verwaltung der Instanz". Never "Betreiber der Instanz":
// that would be two things with almost one name on the same screen.

/** What the authentication is told about this application. */
export const access: AccessRules<Right> = {
  catalogue: applicationRights,
  // The four roles of phase 1 (section 7 of the concept), rows of the tenant
  // from the moment it comes into being. "Leitung" leads: the first account
  // gets that role, it hands out the others, and it works only with a second
  // factor.
  shippedRoles,
  tenantNameProblem,
  // Beside a membership this application keeps the areas somebody holds in,
  // written with an invitation, with the membership it becomes and with a
  // change of roles (section 2.8 of the concept).
  additions: areaAdditions,
  sentences: {
    noTenantChosen: 'Es ist noch kein Betreiber gewählt. Bitte zuerst einen Betreiber auswählen.',
    noAccessToTenant: 'Kein Zugang zu diesem Betreiber.',
    blockedInTenant:
      'Dieser Zugang ist bei diesem Betreiber gesperrt. Die Leitung kann ihn wieder freigeben.',
    alreadyWorksHere: 'Diese Adresse arbeitet schon für diesen Betreiber.',
    notAMember: 'Dieses Konto arbeitet nicht für diesen Betreiber.',
    accountNotOnlyHere:
      'Dieses Konto arbeitet auch für einen anderen Betreiber dieser Instanz oder gehört zu ' +
      'ihrer Verwaltung. Name und E-Mail ändert dann nur die Person selbst.',
    noSuchSessionHere: 'Diese Sitzung gibt es bei diesem Betreiber nicht.',
    lastLead:
      'Das ist die letzte Leitung dieses Betreibers. Erst eine zweite Leitung einsetzen, ' +
      'sonst kann niemand mehr Zugänge verwalten.',
    unusableLink: {
      redeemed: 'Dieser Link wurde schon benutzt. Bitte bei der Leitung einen neuen anfordern.',
      revoked: 'Dieser Link wurde zurückgezogen. Bitte bei der Leitung nachfragen.',
      expired: 'Dieser Link ist abgelaufen. Bitte bei der Leitung einen neuen anfordern.',
    },
    passkeyNotRecorded:
      'Der Passkey ließ sich nicht im Protokoll der Betreiber festhalten und ist deshalb ' +
      'nicht angelegt. Bitte noch einmal versuchen.',
    emptyInstance:
      'Diese Instanz ist noch leer: im Browser steht die Ersteinrichtung, die den ' +
      'Betreiber und den ersten Zugang anlegt.',
    addStaff: {
      usage: 'Aufruf: add-staff <kennung-des-betreibers> <e-mail> "<name>" <rolle> [<rolle> ...]',
      added: (email, tenantId, roles) =>
        `${email} ist beim Betreiber ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`,
      kept: (email, tenantId, roles) =>
        `${email} gab es schon auf dieser Instanz. Die Rollen beim Betreiber ${tenantId} ` +
        `stehen jetzt auf: ${roles.join(', ')}. Das Passwort ist unverändert.`,
      secondFactor:
        'Für die Rolle "Leitung" ist ein zweiter Faktor Pflicht. Die Anwendung fragt bei der ' +
        'ersten Anmeldung danach und richtet ihn ein.',
      noSuchTenant: (tenantId) =>
        `Den Betreiber ${tenantId} gibt es auf dieser Instanz nicht. Die Kennung eines ` +
        'Betreibers steht im Bereich der Instanz bei seinem Namen.',
    },
    instance: {
      alreadyOperator: 'Dieses Konto gehört schon zur Verwaltung der Instanz.',
      notAnOperator: 'Dieses Konto gehört nicht zur Verwaltung der Instanz.',
      notOneself:
        'Aus der Verwaltung der Instanz nimmt sich niemand selbst heraus; das macht ein ' +
        'anderes Konto der Verwaltung.',
      lastOperator: 'Das letzte Konto der Verwaltung der Instanz bleibt.',
      tenantNameMissing: 'Der Name des Betreibers fehlt.',
      leadNameMissing: 'Der Name der Leitung fehlt.',
      leadEmailNotOne: 'Die E-Mail-Adresse der Leitung sieht nicht wie eine aus.',
      appointOperator: {
        usage:
          'Aufruf: appoint-operator <e-mail>\n' +
          'Das Konto muss es auf dieser Instanz schon geben. Es gehört danach zur Verwaltung ' +
          'der Instanz und erreicht ihren Bereich, sobald ein zweiter Faktor eingerichtet ist.',
        appointed: (email) => `${email} gehört jetzt zur Verwaltung dieser Instanz.`,
        secondFactor:
          'Für den Bereich der Instanz ist ein zweiter Faktor Pflicht, eine Authenticator-App ' +
          'oder ein Passkey. Beides wird unter „Konto“ eingerichtet; bis dahin bleibt der ' +
          'Bereich zu.',
        failed: 'Die Verwaltung der Instanz ließ sich nicht erweitern.',
      },
      addTenant: {
        usage: 'Aufruf: add-tenant "<name des betreibers>" <e-mail> "<name der leitung>"',
        createdWithAccount: (name, tenantId, email) =>
          `Der Betreiber "${name}" ist angelegt, Kennung ${tenantId}. ` +
          `${email} ist dort Leitung, mit einem neuen Konto.`,
        createdForAccount: (name, tenantId, email) =>
          `Der Betreiber "${name}" ist angelegt, Kennung ${tenantId}. ` +
          `${email} ist dort Leitung; das Konto gab es schon, das Passwort ist unverändert.`,
        secondFactor:
          'Für die Rolle "Leitung" ist ein zweiter Faktor Pflicht. Die Anwendung fragt bei der ' +
          'ersten Anmeldung danach und richtet ihn ein.',
        failed: 'Der Betreiber konnte nicht angelegt werden.',
      },
    },
  },
}

/** The authentication of this application: under its name and in its words. */
export function createAuthentication(
  options: Omit<AuthenticationOptions, 'application' | 'access'>,
): Authentication {
  return createFor({ ...options, application, access })
}

/** The identity of a session, with the rights of this application. */
export class SessionIdentitySource extends SessionIdentities<Right> {
  constructor(authentication: Authentication, database: Database) {
    super(authentication, database, access)
  }
}

/**
 * The first run of an instance: a tenant with the four roles it starts with
 * and whoever leads it, who also belongs to the administration of the
 * instance from then on.
 */
export function setUpInstance(
  authentication: Authentication,
  database: Database,
  firstRun: FirstRun,
): Promise<FirstRunResult> {
  return setUp(access, authentication, database, firstRun)
}

/** Somebody to put into a tenant, with roles the compiler knows. */
export type StaffMember = Member<RoleKey>

/** Puts a person into a tenant and gives them a way in. */
export function addStaffMember(
  authentication: Authentication,
  database: Database,
  member: StaffMember,
): Promise<{ userId: string; created: boolean }> {
  return addMember(authentication, database, member)
}
