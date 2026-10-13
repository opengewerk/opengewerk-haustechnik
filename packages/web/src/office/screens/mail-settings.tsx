import {
  renderSignature,
  type Right,
  signaturePlaceholders,
  unknownPlaceholders,
} from '@opengewerk/haustechnik-domain'
import {
  MailServerSection,
  type MailServerWords,
  MailStatusSection,
  type MailStatusWords,
  SettingsPage,
  SignaturePreviews,
} from '@opengewerk/platform-web/office'
import { accountQuery, tenantsQuery, useRight } from '@opengewerk/platform-web/session'
import { useQuery } from '@tanstack/react-query'

/**
 * How the signature reads under a message somebody sent, and under one that
 * went by itself (the board "E-Mail-Einstellungen"). An operator that wrote
 * none signs with its name.
 */
function SignatureCases({ template }: { readonly template: string | null }) {
  const account = useQuery(accountQuery)
  const tenants = useQuery(tenantsQuery)
  const operator =
    tenants.data?.find((tenant) => tenant.id === account.data?.tenantId)?.name ?? 'Ihr Betreiber'

  return (
    <SignaturePreviews
      cases={[
        {
          title: 'Von einer Person verschickt',
          text: renderSignature(template, { operator, sender: account.data?.name || 'Ihr Name' }),
        },
        {
          title: 'Automatisch verschickt',
          text: renderSignature(template, { operator, sender: null }),
        },
      ]}
    />
  )
}

/**
 * What this application says where the foundation draws the mail server of
 * an operator (#126): what goes out through it, whose name stands in front of
 * the address, and a signature with the one placeholder `{benutzer}`.
 */
export const mailServerWords: MailServerWords = {
  what:
    'Über diesen Mailserver verschickt der Betreiber alle E-Mails: Erinnerungen an Fristen und ' +
    'Einladungen neuer Zugänge.',
  senderName: 'Der Name davor ist der des Betreibers.',
  signature: {
    placeholder: 'Viele Grüße\n{benutzer}',
    hint:
      'Steht unter jeder E-Mail. {benutzer} ist der Name dessen, der die E-Mail verschickt; bei ' +
      'automatischen E-Mails fällt die Zeile weg. Leer lassen für den Namen des Betreibers allein.',
    problem: (template) => {
      const unknown = unknownPlaceholders(template)

      return unknown.length > 0
        ? `Unbekannt: ${unknown.join(', ')}. Möglich ist ${signaturePlaceholders.join(' und ')}.`
        : undefined
    },
    Previews: SignatureCases,
  },
}

/** What whoever reads the settings without seeing the mail server learns. */
export const mailStatusWords: MailStatusWords = {
  set: (from) =>
    `Eingerichtet. Dieser Betreiber verschickt von ${from}; als Absender steht sein Name davor. ` +
    'Den Mailserver richtet die Leitung hier ein.',
  missing:
    'Nicht eingerichtet, dieser Betreiber verschickt deshalb keine E-Mails. Den Mailserver ' +
    'richtet die Leitung hier ein.',
}

/**
 * "E-Mail-Einstellungen" (#126, the board of that name): how this operator
 * sends mail. The card is the foundation's (ADR 0010 in the repository
 * opengewerk). The mail server is the operator's own and set up here, behind
 * the rights to see and to set it, which section 7 of the concept gives to
 * the Leitung alone: the login to a mailbox is a way of writing in the
 * operator's name to anybody. Whoever reads the settings without those
 * rights learns whether the operator sends mail and from where, and nothing
 * about the server.
 */
export function MailSettingsScreen() {
  const readsServer = useRight('mail.read' satisfies Right)
  const writesServer = useRight('mail.write' satisfies Right)

  return (
    <SettingsPage
      active="e-mail"
      title="E-Mail-Einstellungen"
      sub="Wie dieser Betreiber E-Mails verschickt."
    >
      {readsServer ? (
        <MailServerSection mayWrite={writesServer} words={mailServerWords} />
      ) : (
        <MailStatusSection words={mailStatusWords} />
      )}
    </SettingsPage>
  )
}
