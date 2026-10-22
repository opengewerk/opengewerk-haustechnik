import {
  addressConfirmedSentence,
  closedLabelSentence,
  confirmationFirstSentence,
  confirmationGoneSentence,
  confirmationPath,
  type FaultCategory,
  faultReportLimits,
  labelCodeFromScan,
  type OutsideLabelPage,
  type OutsideReportReceipt,
  outsideReportProblems,
  outsideReportRules,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, SelectField, TextArea } from '@opengewerk/platform-web'
import { PhotoTaker } from '@opengewerk/platform-web/forms'
import { Gate, GateText, GateWaiting } from '@opengewerk/platform-web/gate'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleCheck, DoorOpen, Lock, Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'

import { PhotoPreview } from '../site/reporting.js'

/** What the page of a label says (#332), in one place. */
export const outsideWords = {
  report: 'Störung melden',
  loading: 'Die Seite des Etiketts wird geladen.',
  onTheLabel: 'Am Etikett',
  noRoom: 'Ohne Raum',
  category: 'Kategorie',
  choose: 'Bitte wählen',
  description: 'Beschreibung',
  descriptionHint: 'Was ist kaputt, und seit wann?',
  photo: 'Foto (freiwillig)',
  contact: 'E-Mail für eine Rückmeldung (freiwillig)',
  contactHint: confirmationFirstSentence,
  noticeBefore:
    'Die Meldung geht an den Betreiber des Gebäudes. Nach Ihrem Namen wird nicht gefragt. Wie die Angaben verarbeitet werden, steht in den',
  privacy: 'Datenschutzhinweisen',
  send: 'Melden',
  withAccount: 'Mit Konto?',
  signIn: 'Anmelden',
  withAccountAfter: ', dann öffnet das Etikett den Raum.',
  closed: 'Anmeldung nötig',
  done: 'Gemeldet',
  thanks: 'Danke. Der Betreiber sieht Ihre Meldung jetzt.',
  thanksWithAddress:
    'Danke. Der Betreiber sieht Ihre Meldung jetzt. An Ihre Adresse geht gleich eine E-Mail mit einem Link. Bestätigen Sie damit die Adresse, dann schreibt er Ihnen, wenn die Meldung angenommen und wenn sie erledigt ist.',
  confirming: 'Die Adresse wird bestätigt.',
  confirmed: 'Adresse bestätigt',
  notConfirmed: 'Nicht bestätigt',
  photoLost: 'Das Foto ist nicht angekommen. Die Meldung selbst ist angekommen, ohne Foto.',
  another: 'Noch eine Störung melden',
  unavailable: 'Gerade nicht möglich',
  offline: 'Der Server antwortet nicht. Versuchen Sie es gleich noch einmal.',
  check: 'Bitte prüfen Sie die markierten Angaben.',
  // The field nobody sees, for a machine that fills in every field it finds.
  trap: 'Webseite',
} as const

/** Where the privacy notice of the instance stands, before any router. */
const privacyPath = '/rechtliches/datenschutz'

/**
 * The page of the application at the address of a label, for somebody not
 * signed in (#332): the label, for a report without an account. Nothing for
 * any other address, and nothing where the sign in is asked for, so that the
 * gate shows it and, after it, the record the label belongs to.
 */
export function signedOutPage(address: URL): ReactNode {
  if (address.searchParams.has('anmelden')) {
    return null
  }

  // The link of the mail that confirms an address for an answer (S12).
  if (address.pathname === confirmationPath) {
    return <ConfirmAddress secret={address.hash.slice(1)} />
  }

  const code = labelCodeFromScan(address.href)

  return code === null ? null : <ReportByLabel code={code} />
}

/** The same address with the sign in asked for, which the gate then shows. */
function signInHere(): void {
  const here = new URL(globalThis.location.href)

  here.searchParams.set('anmelden', '')
  globalThis.location.assign(here.pathname + here.search)
}

function pageKey(code: string) {
  return ['outside-report', code] as const
}

/**
 * "Störung melden" without an account, the boards "HT-Tor-Stoerung-…": the
 * room on the label, a category, a description, a photo, and an address for
 * the answer if somebody wants one. Every label that takes no report says
 * the same: that it takes a sign in.
 */
export function ReportByLabel({ code }: { readonly code: string }) {
  const page = useQuery({
    queryKey: pageKey(code),
    queryFn: () => request<OutsideLabelPage>(`/fault-reports/by-label/${encodeURIComponent(code)}`),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [sent, setSent] = useState<{
    readonly withAddress: boolean
    readonly photoLost: boolean
  } | null>(null)
  const queries = useQueryClient()

  if (page.isPending) {
    return <GateWaiting>{outsideWords.loading}</GateWaiting>
  }

  if (page.isError) {
    return (
      <Gate title={outsideWords.unavailable}>
        <GateText muted={false}>
          {page.error instanceof RequestRefused ? page.error.message : outsideWords.offline}
        </GateText>
      </Gate>
    )
  }

  const answer = page.data

  if (!answer.open) {
    return (
      <Gate title={outsideWords.closed}>
        <div className="flex items-start gap-3">
          <Lock
            size={24}
            strokeWidth={2.1}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-ink-muted"
          />
          <GateText muted={false}>{closedLabelSentence}</GateText>
        </div>
        <Button tone="primary" wide onClick={signInHere}>
          {outsideWords.signIn}
        </Button>
      </Gate>
    )
  }

  if (sent !== null) {
    return (
      <Gate title={outsideWords.done}>
        <div className="flex items-start gap-3">
          <CircleCheck
            size={26}
            strokeWidth={2.2}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-done"
          />
          <GateText muted={false}>
            {sent.withAddress ? outsideWords.thanksWithAddress : outsideWords.thanks}
          </GateText>
        </div>
        {sent.photoLost ? <GateText>{outsideWords.photoLost}</GateText> : null}
        <RoomOnTheLabel room={answer.room} />
        <Button
          wide
          icon={Plus}
          onClick={() => {
            setSent(null)
            // A new form, with the moment it was opened.
            void queries.invalidateQueries({ queryKey: pageKey(code) })
          }}
        >
          {outsideWords.another}
        </Button>
      </Gate>
    )
  }

  return (
    <ReportForm
      code={code}
      room={answer.room}
      categories={answer.categories}
      form={answer.form}
      onSent={setSent}
    />
  )
}

/**
 * The page the link of the mail opens, boards "HT-Tor-Adresse-…" (S12 of the
 * review of phase 2): it hands the secret from behind the "#" to the server
 * once, says what came of it, and takes the secret out of the address.
 */
export function ConfirmAddress({ secret }: { readonly secret: string }) {
  const confirming = useQuery({
    queryKey: ['outside-address', secret],
    queryFn: () =>
      request<{ readonly confirmed: true }>('/fault-reports/by-label/address/confirmation', {
        method: 'POST',
        body: JSON.stringify({ link: secret }),
      }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
  const answered = !confirming.isPending

  // The secret is spent either way: it does not stay in the address or its history.
  useEffect(() => {
    if (answered) {
      globalThis.history.replaceState(null, '', confirmationPath)
    }
  }, [answered])

  if (confirming.isPending) {
    return <GateWaiting>{outsideWords.confirming}</GateWaiting>
  }

  if (confirming.isError) {
    const refused = confirming.error instanceof RequestRefused

    return (
      <Gate title={refused ? outsideWords.notConfirmed : outsideWords.unavailable}>
        <div className="flex items-start gap-3">
          <Lock
            size={24}
            strokeWidth={2.1}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-ink-muted"
          />
          <GateText muted={false}>
            {refused ? confirmationGoneSentence : outsideWords.offline}
          </GateText>
        </div>
      </Gate>
    )
  }

  return (
    <Gate title={outsideWords.confirmed}>
      <div className="flex items-start gap-3">
        <CircleCheck
          size={26}
          strokeWidth={2.2}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-done"
        />
        <GateText muted={false}>{addressConfirmedSentence}</GateText>
      </div>
    </Gate>
  )
}

function RoomOnTheLabel({ room }: { readonly room: string | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[5px] bg-surface-sunken px-3.5 py-3">
      <DoorOpen size={22} aria-hidden="true" className="shrink-0 text-ink-muted" />
      <div className="min-w-0">
        <div className="text-[13px] text-ink-muted">{outsideWords.onTheLabel}</div>
        <div className="text-[17px] font-semibold [overflow-wrap:anywhere]">
          {room ?? outsideWords.noRoom}
        </div>
      </div>
    </div>
  )
}

function ReportForm({
  code,
  room,
  categories,
  form,
  onSent,
}: {
  readonly code: string
  readonly room: string | null
  readonly categories: readonly FaultCategory[]
  readonly form: string
  readonly onSent: (sent: { readonly withAddress: boolean; readonly photoLost: boolean }) => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [website, setWebsite] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function send(event?: FormEvent) {
    event?.preventDefault()
    setTrouble(null)

    const wanted = { categoryId, description: description.trim(), contact: contact.trim() }
    const wrong = outsideReportProblems(wanted)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(outsideWords.check)

      return
    }

    setWorking(true)

    try {
      const receipt = await request<OutsideReportReceipt>(
        `/fault-reports/by-label/${encodeURIComponent(code)}`,
        {
          method: 'POST',
          body: JSON.stringify({ ...wanted, photo: photo !== null, form, website }),
        },
      )
      let photoLost = false

      if (photo !== null && receipt.photo !== null) {
        try {
          await request(
            `/fault-reports/by-label/${encodeURIComponent(code)}/photo/${encodeURIComponent(receipt.photo)}`,
            {
              method: 'PUT',
              body: await photo.arrayBuffer(),
              headers: { 'Content-Type': 'application/octet-stream' },
            },
          )
        } catch {
          photoLost = true
        }
      }

      onSent({ withAddress: wanted.contact !== '', photoLost })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : outsideWords.offline)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Gate title={outsideWords.report}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void send(event)
        }}
      >
        <RoomOnTheLabel room={room} />
        <SelectField
          label={outsideWords.category}
          required
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: '', label: outsideWords.choose },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
          {...(problems['categoryId'] ? { problem: problems['categoryId'] } : {})}
        />
        <TextArea
          label={outsideWords.description}
          rows={4}
          required
          maxLength={faultReportLimits.description}
          placeholder={outsideWords.descriptionHint}
          value={description}
          problem={problems['description']}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-medium">{outsideWords.photo}</span>
          {/* Only the kinds of picture the server takes from outside, at the
              camera and in the gallery (#458). */}
          <PhotoTaker
            label={outsideWords.photo}
            accept={outsideReportRules.photoTypes.join(',')}
            disabled={working}
            photo={
              photo === null ? null : <PhotoPreview photo={photo} label={outsideWords.photo} />
            }
            onTake={(chosen) => {
              setPhoto(chosen.size <= outsideReportRules.photoBytes ? chosen : null)
            }}
          />
        </div>
        <Field
          label={outsideWords.contact}
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={outsideReportRules.address}
          value={contact}
          hint={outsideWords.contactHint}
          {...(problems['contact'] ? { problem: problems['contact'] } : {})}
          onChange={(event) => {
            setContact(event.target.value)
          }}
        />
        {/* The field nobody sees: out of sight, out of the tab order and out
            of what a reader hears. A person never fills it in, a machine that
            fills in every field does, and its report is answered and kept
            nowhere (decided 15.10.2026). */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            {outsideWords.trap}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value)
              }}
            />
          </label>
        </div>
        <GateText>
          {outsideWords.noticeBefore} <a href={privacyPath}>{outsideWords.privacy}</a>.
        </GateText>
        {trouble ? (
          <p role="alert" className="text-[15px] leading-[1.5] text-conflict">
            {trouble}
          </p>
        ) : null}
        <Button tone="primary" wide icon={Check} type="submit" disabled={working}>
          {outsideWords.send}
        </Button>
        <GateText>
          {outsideWords.withAccount}{' '}
          <a
            href="#anmelden"
            onClick={(event) => {
              event.preventDefault()
              signInHere()
            }}
          >
            {outsideWords.signIn}
          </a>
          {outsideWords.withAccountAfter}
        </GateText>
      </form>
    </Gate>
  )
}
