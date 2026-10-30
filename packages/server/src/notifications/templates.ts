import type { ActivityKind } from '@opengewerk/haustechnik-domain'
import { invitationLinkPlaceholder, type PushText } from '@opengewerk/platform-server'

/**
 * What the messages of this application say (#126, section 3 of the
 * concept), as functions of what they are about.
 *
 * A message says what is due and by when, and nothing about whom or where:
 * no name of a person, no address, no room and no word somebody typed. A push
 * message passes through the push service of the browser's maker, and a mail
 * through every server between the operator and a mailbox; what is behind the
 * message the application shows after the tap or the link, to somebody who is
 * signed in and sees the area. That holds for the mail about a deadline as
 * well: what a deadline follows is named by an asset, a property or the words
 * somebody typed about a defect, so the mail names the kind and the day and
 * leaves the rest to the list.
 */

/** A message by mail as it goes into the outbox. */
export interface MessageText {
  readonly subject: string
  readonly body: string
}

/** A day as people here write it: 12.11.2026. */
export function germanDate(day: string): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** How a message greets: by the name of the account, or without one. */
function greeting(name: string | null): string {
  return name ? `Guten Tag ${name},` : 'Guten Tag,'
}

/** A deadline as its reminder names it. */
export interface DueDeadline {
  /** What the kind is called: "Zählerablesung zum Stichtag". */
  readonly kind: string
  readonly dueOn: string
}

/**
 * The reminder to whoever answers for a deadline, sent when it comes within
 * its lead: what, by when, and the way to the list. Nobody sent it by hand,
 * so the signature is the one without a sender.
 */
export function deadlineDueMessage(facts: {
  readonly deadline: DueDeadline
  readonly recipientName: string | null
  /** Where the instance is reached, for the link to the list. */
  readonly origin: string
  readonly signature: string
}): MessageText {
  const { deadline } = facts
  const body = [
    greeting(facts.recipientName),
    '',
    `am ${germanDate(deadline.dueOn)} ist diese Frist fällig:`,
    '',
    deadline.kind,
    '',
    `Was dahinter steht, zeigt die Liste der Fristen: ${facts.origin}/fristen`,
    '',
    '-- ',
    facts.signature,
  ].join('\n')

  return {
    subject: `Frist am ${germanDate(deadline.dueOn)}: ${deadline.kind}`,
    body,
  }
}

/** Where the link of an invitation goes in its message; the job makes it as it sends. */
export const invitationLink = invitationLinkPlaceholder

/**
 * The invitation of an access, with the link by mail instead of handed on by
 * whoever leads. It names the operator the person is to work for and who
 * invited them, both of which the person invited has to know to trust it.
 */
export function invitationMessage(facts: {
  /** The name the invitation was written for. */
  readonly name: string
  readonly operator: string
  readonly inviter: string | null
  readonly expiresAt: Date
  /** What the application is called. */
  readonly application: string
  readonly signature: string
}): MessageText {
  const until = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(facts.expiresAt)

  const body = [
    greeting(facts.name || null),
    '',
    `${facts.inviter ?? 'Jemand'} hat Sie eingeladen, bei ${facts.operator} mit ${facts.application} ` +
      'zu arbeiten. Über diesen Link legen Sie Ihr Passwort fest und sind danach angemeldet:',
    '',
    invitationLink,
    '',
    `Der Link gilt bis zum ${until} und funktioniert genau einmal. Wenn Sie mit dieser ` +
      'Einladung nichts anfangen können, müssen Sie nichts tun.',
    '',
    '-- ',
    facts.signature,
  ].join('\n')

  return { subject: `Einladung zu ${facts.application}: ${facts.operator}`, body }
}

/** The link to a new password, through the mail server of the instance (#81). */
export function passwordResetMessage(facts: {
  readonly name: string
  readonly link: string
  readonly application: string
}): MessageText {
  const body = [
    greeting(facts.name || null),
    '',
    `für Ihren Zugang zu ${facts.application} wurde ein neues Passwort angefordert. Über diesen ` +
      'Link wählen Sie es:',
    '',
    facts.link,
    '',
    'Der Link gilt eine Stunde und funktioniert genau einmal. Danach sind alle Geräte ' +
      'abgemeldet, auf denen Sie angemeldet waren. Wenn Sie kein neues Passwort angefordert ' +
      'haben, müssen Sie nichts tun: das alte gilt weiter.',
    '',
    '-- ',
    facts.application,
  ].join('\n')

  return { subject: `Neues Passwort für ${facts.application}`, body }
}

/** The notice that a passkey was added to an account, through the mail server of the instance (#81). */
export function passkeyAddedMessage(facts: {
  readonly name: string
  readonly passkey: string
  readonly addedAt: Date
  readonly link: string
  readonly application: string
}): MessageText {
  const when = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(facts.addedAt)

  const body = [
    greeting(facts.name || null),
    '',
    `für Ihren Zugang zu ${facts.application} wurde am ${when} Uhr ein neuer Passkey angelegt: ` +
      `„${facts.passkey}“. Mit ihm melden Sie sich ohne Passwort an, bestätigt mit ` +
      'Fingerabdruck, Gesicht oder PIN am Gerät.',
    '',
    'Ihre Passkeys sehen Sie unter „Konto“:',
    '',
    facts.link,
    '',
    'Wenn Sie diesen Passkey nicht selbst angelegt haben, löschen Sie ihn dort, ändern Sie Ihr ' +
      'Passwort und sagen Sie der Leitung Bescheid.',
    '',
    '-- ',
    facts.application,
  ].join('\n')

  return { subject: `Ein neuer Passkey für ${facts.application}`, body }
}

/** The moment of a change, as a mail names it: day and time in Berlin. */
function momentOf(at: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

/**
 * The notice of a new set of recovery codes (#360), to the account, through
 * the mail server of the instance. No codes in it, and no link that does
 * anything by itself.
 */
export function recoveryCodesRenewedMessage(facts: {
  readonly name: string
  readonly renewedAt: Date
  readonly link: string
  readonly application: string
}): MessageText {
  const body = [
    greeting(facts.name || null),
    '',
    `für Ihren Zugang zu ${facts.application} wurden am ${momentOf(facts.renewedAt)} Uhr neue ` +
      'Wiederherstellungscodes erzeugt. Die bisherigen gelten seitdem nicht mehr.',
    '',
    'Ihren Zugang sehen Sie unter „Konto“:',
    '',
    facts.link,
    '',
    'Wenn Sie die Codes nicht selbst erzeugt haben, ändern Sie Ihr Passwort, erzeugen Sie dort ' +
      'neue Codes und sagen Sie der Leitung Bescheid.',
    '',
    '-- ',
    facts.application,
  ].join('\n')

  return { subject: `Neue Wiederherstellungscodes für ${facts.application}`, body }
}

/**
 * The mail to an account once the app was set up on it, or every second
 * factor of it was taken away (#591, N6 of the security audit of the
 * repository opengewerk). The first needed nothing but a password on an
 * account without one, the second is done by whoever manages the accesses of
 * an operator or on the server; the person should hear of both.
 */
export function secondFactorChangedMessage(facts: {
  readonly name: string
  readonly change: 'app' | 'reset'
  readonly changedAt: Date
  readonly link: string
  readonly application: string
}): MessageText {
  const what =
    facts.change === 'app'
      ? `wurde am ${momentOf(facts.changedAt)} Uhr eine Authenticator-App als zweiter ` +
        'Faktor eingerichtet.'
      : `wurde am ${momentOf(facts.changedAt)} Uhr der zweite Faktor zurückgesetzt: die ` +
        'Authenticator-App und alle Passkeys sind entfernt, und alle Geräte sind abgemeldet. ' +
        'Bei der nächsten Anmeldung richten Sie einen neuen ein.'
  const yourself =
    facts.change === 'app'
      ? 'Wenn Sie die App nicht selbst eingerichtet haben, ändern Sie Ihr Passwort und sagen ' +
        'Sie der Leitung Bescheid.'
      : 'Wenn Sie das nicht erwartet haben, sagen Sie der Leitung Bescheid.'
  const body = [
    greeting(facts.name || null),
    '',
    `für Ihren Zugang zu ${facts.application} ${what}`,
    '',
    'Ihren Zugang sehen Sie unter „Konto“:',
    '',
    facts.link,
    '',
    yourself,
    '',
    '-- ',
    facts.application,
  ].join('\n')

  return {
    subject:
      facts.change === 'app'
        ? `Authenticator-App für ${facts.application} eingerichtet`
        : `Zweiter Faktor für ${facts.application} zurückgesetzt`,
    body,
  }
}

/**
 * The mail to every account of the administration of the instance when one
 * was named to it or taken off (#360), and to the one taken off. Whoever is
 * in the administration sets up the mail server of the instance, and through
 * it goes the link to a new password of every account.
 */
export function operatorsChangedMessage(facts: {
  readonly name: string
  readonly appointed: boolean
  readonly person: string
  readonly personEmail: string
  readonly changedAt: Date
  readonly link: string
  readonly application: string
}): MessageText {
  const who = facts.person ? `${facts.person} (${facts.personEmail})` : facts.personEmail
  const what = facts.appointed
    ? `wurde ${who} zur Verwaltung Ihrer Instanz von ${facts.application} benannt.`
    : `wurde ${who} aus der Verwaltung Ihrer Instanz von ${facts.application} genommen.`

  const body = [
    greeting(facts.name || null),
    '',
    `am ${momentOf(facts.changedAt)} Uhr ${what} Die Verwaltung der Instanz richtet ein, was ` +
      'allen Betreibern gemeinsam ist, darunter den Mailserver, über den der Link zu einem neuen ' +
      'Passwort geht.',
    '',
    'Die Änderung steht im Protokoll der Instanz:',
    '',
    facts.link,
    '',
    'Wenn Ihnen niemand diese Änderung angekündigt hat, fragen Sie bei den anderen Konten der ' +
      'Verwaltung nach.',
    '',
    '-- ',
    facts.application,
  ].join('\n')

  return {
    subject: `Die Verwaltung Ihrer Instanz von ${facts.application} hat sich geändert`,
    body,
  }
}

/**
 * The mail about a new mail server of the instance (#360), to the lead of
 * every operator on it.
 *
 * The link to a new password goes out through that server, and whoever sets
 * it up could read the links there. So the lead of every operator learns of a
 * change, through the server of before: what it is now, when, where the change
 * stands in the log, and what to do if nobody announced it. It names no person
 * and carries no link that does anything by itself.
 */
export function mailServerChangedMessage(facts: {
  readonly name: string
  readonly host: string | null
  readonly fromAddress: string | null
  readonly changedAt: Date
  readonly link: string
  readonly application: string
}): MessageText {
  const when = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(facts.changedAt)
  const what =
    facts.host === null
      ? `am ${when} Uhr wurde der Mailserver der Instanz entfernt. Bis wieder einer ` +
        'eingetragen ist, bekommt niemand mehr einen Link zu einem neuen Passwort.'
      : `am ${when} Uhr wurde der Mailserver der Instanz geändert. E-Mails an einen Zugang, ` +
        `darunter der Link zu einem neuen Passwort, gehen jetzt über ${facts.host}, ` +
        `als Absender steht ${facts.fromAddress ?? facts.host} darin.`

  const body = [
    greeting(facts.name || null),
    '',
    `${what} Diese Nachricht kommt noch über den Mailserver von vorher.`,
    '',
    'Die Änderung steht im Änderungsprotokoll Ihres Betreibers, ebenso jedes Passwort, das ' +
      'für einen Zugang dort neu gesetzt wird:',
    '',
    facts.link,
    '',
    'Wenn Ihnen niemand, der die Instanz betreibt, diese Änderung angekündigt hat, fragen Sie ' +
      'nach und sehen Sie im Änderungsprotokoll nach, ob ein Passwort neu gesetzt wurde, das ' +
      'niemand von Ihnen neu gesetzt hat.',
    '',
    '-- ',
    facts.application,
  ].join('\n')

  return { subject: `Der Mailserver Ihrer Instanz von ${facts.application} wurde geändert`, body }
}

/** A deadline the person answers for, by the name of its kind and its day. */
export function deadlineDuePush(facts: {
  readonly kind: string
  readonly dueOn: string
}): PushText {
  return { title: `Frist am ${germanDate(facts.dueOn)}`, body: facts.kind }
}

/** What an activity is called in a sentence that says somebody got one. */
const assignedWords: Readonly<Record<ActivityKind, string>> = {
  round: 'ein Rundgang',
  inspection: 'eine Prüfung',
  maintenance: 'eine Wartung',
  work_order: 'ein Arbeitsauftrag',
}

/** An activity that went to the person, by its kind and, where it has one, its day. */
export function assignedPush(facts: {
  readonly kind: ActivityKind
  readonly dueOn: string | null
}): PushText {
  return {
    title: 'Neu zugeteilt',
    body: facts.dueOn
      ? `Ihnen wurde ${assignedWords[facts.kind]} zugeteilt, fällig am ${germanDate(facts.dueOn)}.`
      : `Ihnen wurde ${assignedWords[facts.kind]} zugeteilt.`,
  }
}

/** A work order of the urgency "sofort", which reaches whoever leads it whatever they switched off. */
export function immediatePush(): PushText {
  return {
    title: 'Auftrag: sofort',
    body: 'Sie führen einen Arbeitsauftrag der Dringlichkeit „sofort“.',
  }
}

/** A task of the person's that falls due today. */
export function taskDuePush(): PushText {
  return { title: 'Heute fällig', body: 'Eine Aufgabe ist heute für Sie fällig.' }
}

/** A round that waits for its countersignature, or a work order that waits for its acceptance. */
export function waitingPush(kind: ActivityKind): PushText {
  return kind === 'work_order'
    ? { title: 'Wartet auf Abnahme', body: 'Ein Arbeitsauftrag wartet auf Ihre Abnahme.' }
    : {
        title: 'Wartet auf Gegenzeichnung',
        body: 'Ein Rundgang wartet auf Ihre Gegenzeichnung.',
      }
}

/** A work order the person signed and somebody sent back. */
export function rejectedPush(): PushText {
  return {
    title: 'Auftrag zurückgewiesen',
    body: 'Ein Arbeitsauftrag, den Sie unterschrieben haben, wurde zurückgewiesen.',
  }
}

/** A fault reported in an area of the person, named by nothing it says (section 3 of the concept). */
export function faultReceivedPush(): PushText {
  return {
    title: 'Störung eingegangen',
    body: 'In einem Ihrer Bereiche ist eine Störung gemeldet worden.',
  }
}

/** A fault the person reported, accepted or done. */
export function faultAnsweredPush(step: 'accepted' | 'done'): PushText {
  return step === 'accepted'
    ? {
        title: 'Störmeldung angenommen',
        body: 'Eine Störung, die Sie gemeldet haben, wird jetzt bearbeitet.',
      }
    : { title: 'Störung erledigt', body: 'Eine Störung, die Sie gemeldet haben, ist erledigt.' }
}

/** The message a person sends themselves from "Konto", to see that push works. */
export function testPush(application: string): PushText {
  return {
    title: 'Probenachricht',
    body: `So kommen Benachrichtigungen von ${application} auf diesem Gerät an.`,
  }
}
