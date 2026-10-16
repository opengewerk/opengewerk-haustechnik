import {
  briefingLimits,
  type FormDefinition,
  type FormField,
  type FormValues,
  type IsoDate,
  permitAnswersProblems,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, Choice, Field, Panel, TextArea } from '@opengewerk/platform-web'
import { clockTime, today } from '@opengewerk/platform-web/format'
import { AnswerProgress } from '@opengewerk/platform-web/forms'
import { useRight, useWho } from '@opengewerk/platform-web/session'
import {
  SignaturePad,
  SiteActionBar,
  SiteFacts,
  SiteHeader,
  SiteLabel,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { maybeText, text, useRecord, useRelated, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Plus, Signature } from 'lucide-react'
import { useState } from 'react'

import { issueWorkPermit, permitFormOn, takeBriefing } from '../../app/visits.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { NotOffered, NotOnDevice } from '../kit.js'
import { siteForms } from '../places.js'
import { usePlaceWords, useWorkOrder } from './work-order.js'

/**
 * A contractor at work at a work order on site (section 4.11 of the concept,
 * #330, the boards "Auftrag einer Fremdfirma", "Einweisung" and
 * "Erlaubnisschein"): the card on the order, the briefing of one of its
 * people and the permit for hot work, also without a network. Whoever leads
 * the order or plans and hands out work briefs and issues; once confirmed,
 * nothing changes either.
 */
export const visitWords = {
  title: 'Fremdfirma vor Ort',
  briefed: (name: string) => `${name} eingewiesen`,
  permit: 'Erlaubnisschein',
  permitFor: (name: string | null) => (name === null ? 'ausgestellt' : `für ${name}`),
  pending: ' · noch nicht übertragen',
  none: 'Noch niemand eingewiesen und kein Erlaubnisschein.',
  brief: 'Einweisen',
  issue: 'Erlaubnisschein ausstellen',
  who: 'Einweisen und einen Erlaubnisschein ausstellen kann, wer den Auftrag führt oder Arbeit plant und verteilt.',
  notOffered:
    'Eingewiesen wird bei einem Auftrag einer Fremdfirma aus der Liste, solange er läuft.',
  briefing: 'Einweisung',
  order: 'Auftrag',
  what: 'Was',
  where: 'Wo',
  firm: 'Fremdfirma',
  name: 'Name in Druckschrift',
  nameHint: 'Der Name der eingewiesenen Person, wie er an der Einweisung steht.',
  subject: 'Worin eingewiesen',
  subjectHint:
    'Zum Beispiel Fluchtwege, Brandmeldeanlage, Absperrungen und wen die Person vor Ort anspricht.',
  signature: 'Unterschrift der eingewiesenen Person',
  pad: 'Unterschrift der eingewiesenen Person',
  covered: (name: string) =>
    `Aufgenommen auf dem Gerät von ${name}. Die Einweisung nennt dieses Konto.`,
  back: 'Zurück',
  confirm: 'Einweisung bestätigen',
  then: 'Danach lässt sich die Einweisung nicht mehr ändern.',
  version: (version: number) => `Formular aus dem Paket Brandschutz, Fassung ${String(version)}`,
  signerName: 'Name in Druckschrift',
  signerHint: 'Die Person, die die Arbeiten ausführt.',
  noForm:
    'Einen Erlaubnisschein kennt dieses Gerät nicht. Das Formular kommt mit dem Paket Brandschutz.',
  notShown: (label: string) => `${label}: dieses Feld nimmt der Erlaubnisschein hier nicht auf.`,
  issued: (name: string) =>
    `Ausgestellt auf dem Gerät von ${name}. Der Erlaubnisschein nennt dieses Konto.`,
  grant: 'Erlaubnis erteilen',
  grantThen:
    'Erst wenn alles beantwortet ist. Danach lässt sich der Erlaubnisschein nicht mehr ändern.',
} as const

/** Whether a record is there and not marked. */
function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/** A value of JSON as the device holds it, as its text. */
function parsed(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

/** The name of whoever signed in a permit, out of the first signature among its answers. */
function signerOf(permit: RecordState): string | null {
  const answers = parsed(permit['answers'])
  const values =
    typeof answers === 'object' && answers !== null ? Object.values(answers as object) : []
  const signed = values.find(
    (value): value is { readonly name: string } =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { readonly name?: unknown }).name === 'string' &&
      typeof (value as { readonly path?: unknown }).path === 'string',
  )

  return signed?.name ?? null
}

/**
 * Whether the person holding the device briefs at the order now: it is under
 * way, a firm of the list carries it out, and the person leads it or plans
 * and hands out work (decided on 15.10.2026).
 */
function useBriefs(activityId: string) {
  const work = useWorkOrder(activityId)
  const writes = useRight('activity.write')
  const contractorId = maybeText(work.activity, 'contractorId')

  return {
    work,
    contractorId,
    briefs: work.editable && contractorId !== null && (work.responsible === work.me || writes),
  }
}

/** One line of the card: what happened, and when, and whether it is still on its way. */
function VisitLine({
  said,
  meta,
  pending,
}: {
  readonly said: string
  readonly meta: string
  readonly pending: boolean
}) {
  return (
    <li className="border-b border-row py-2.5 last:border-b-0">
      <p className="text-[17px] leading-[1.4] [overflow-wrap:anywhere]">{said}</p>
      <p className="mt-0.5 text-[14px] text-ink-muted">
        {meta}
        {pending ? <span className="font-semibold text-waiting">{visitWords.pending}</span> : null}
      </p>
    </li>
  )
}

/**
 * The card "Fremdfirma vor Ort" on a work order a firm of the list carries
 * out: who was briefed and the permits, with the way to add either for whoever
 * briefs. Nothing on an order without a firm of the list.
 */
export function VisitCard({ activityId }: { readonly activityId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const catalogue = useCatalogue()
  const { work, contractorId, briefs } = useBriefs(activityId)
  const firm = useRecord('contractors', contractorId ?? undefined)
  const briefings = useRelated('briefings', 'activityId', activityId).filter(live)
  const permits = useRelated('work_permits', 'activityId', activityId).filter(live)

  if (contractorId === null) {
    return null
  }

  const when = (record: RecordState) => clockTime(new Date(text(record, 'signedAt')))
  const lines = [
    ...briefings.map((briefing) => ({
      key: String(briefing['id']),
      at: text(briefing, 'signedAt'),
      said: visitWords.briefed(text(briefing, 'personName')),
      meta: when(briefing),
      pending: client.isPending('briefings', String(briefing['id'])),
    })),
    ...permits.map((permit) => ({
      key: String(permit['id']),
      at: text(permit, 'signedAt'),
      said: visitWords.permit,
      meta: `${visitWords.permitFor(signerOf(permit))}, ${when(permit)}`,
      pending: client.isPending('work_permits', String(permit['id'])),
    })),
  ].sort((left, right) => (left.at < right.at ? -1 : 1))
  const permitForm = permitFormOn(catalogue, today() as IsoDate)

  return (
    <Panel title={visitWords.title}>
      <div className="flex flex-col gap-2.5">
        <SiteFacts facts={[{ label: visitWords.firm, value: text(firm, 'name') }]} />
        {lines.length === 0 ? (
          <SiteText muted size={15}>
            {visitWords.none}
          </SiteText>
        ) : (
          <ul aria-label={visitWords.title} className="flex flex-col">
            {lines.map((line) => (
              <VisitLine key={line.key} said={line.said} meta={line.meta} pending={line.pending} />
            ))}
          </ul>
        )}
        {briefs ? (
          <div className="flex flex-col gap-2">
            <Button
              wide
              height={48}
              icon={Signature}
              onClick={() => {
                void navigate({ to: siteForms.briefing(activityId) })
              }}
            >
              {visitWords.brief}
            </Button>
            {permitForm === null ? null : (
              <Button
                wide
                height={48}
                icon={Plus}
                onClick={() => {
                  void navigate({ to: siteForms.permit(activityId) })
                }}
              >
                {visitWords.issue}
              </Button>
            )}
          </div>
        ) : work.editable ? (
          <SiteText muted size={15}>
            {visitWords.who}
          </SiteText>
        ) : null}
      </div>
    </Panel>
  )
}

/** The order and its firm, as the briefing and the permit begin. */
function OrderOfVisit({
  activityId,
  contractorId,
}: {
  readonly activityId: string
  readonly contractorId: string
}) {
  const activity = useRecord('activities', activityId)
  const firm = useRecord('contractors', contractorId)
  const place = usePlaceWords(activity)

  return (
    <Panel title={visitWords.order}>
      <SiteFacts
        facts={[
          { label: visitWords.what, value: text(activity, 'title') },
          ...(place === '' ? [] : [{ label: visitWords.where, value: place }]),
          { label: visitWords.firm, value: text(firm, 'name') },
        ]}
      />
    </Panel>
  )
}

/** The briefing of a person of the firm on site: the name, in what, and the drawing. */
export function SiteBriefingScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const { work, contractorId, briefs } = useBriefs(activityId)
  const [personName, setPersonName] = useState('')
  const [subject, setSubject] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const back = { to: siteForms.form(activityId), label: 'Zurück zum Auftrag' }

  if (work.activity === null) {
    return <NotOnDevice what="Diesen Auftrag" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (!briefs || contractorId === null) {
    return (
      <NotOffered title={visitWords.briefing} back={back}>
        {contractorId === null || !work.editable ? visitWords.notOffered : visitWords.who}
      </NotOffered>
    )
  }

  const complete = personName.trim() !== '' && subject.trim() !== '' && path !== null

  async function confirm() {
    if (!complete || path === null || contractorId === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const problem = await takeBriefing(client, {
        activityId,
        contractorId,
        personName,
        subject,
        path,
      })

      if (problem !== null) {
        setTrouble(problem)

        return
      }

      void navigate({ to: back.to })
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SiteHeader
        title={visitWords.briefing}
        sub={maybeText(work.order, 'number') ?? undefined}
        back={back}
      />
      <SiteScreen>
        <OrderOfVisit activityId={activityId} contractorId={contractorId} />
        <Field
          label={visitWords.name}
          hint={visitWords.nameHint}
          value={personName}
          maxLength={briefingLimits.personName}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setPersonName(event.target.value)
          }}
        />
        <TextArea
          label={visitWords.subject}
          hint={visitWords.subjectHint}
          value={subject}
          rows={4}
          maxLength={briefingLimits.subject}
          onChange={(event) => {
            setSubject(event.target.value)
          }}
        />
        <div className="flex flex-col gap-2">
          <SiteLabel>{visitWords.signature}</SiteLabel>
          <SignaturePad label={visitWords.pad} onChange={setPath} />
        </div>
        <SiteText muted>{visitWords.covered(who.name)}</SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={visitWords.then}>
        <Button
          height={60}
          onClick={() => {
            void navigate({ to: back.to })
          }}
        >
          {visitWords.back}
        </Button>
        <Button
          tone="primary"
          height={60}
          icon={Signature}
          disabled={working || !complete}
          onClick={() => {
            void confirm()
          }}
        >
          {visitWords.confirm}
        </Button>
      </SiteActionBar>
    </>
  )
}

/** A field of the permit with what was entered, for the kinds a permit takes in. */
function PermitField({
  field,
  value,
  onChange,
}: {
  readonly field: FormField
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState<string | null>(null)

  switch (field.kind) {
    case 'text':
      return field.multiline === true ? (
        <TextArea
          label={field.label}
          hint={field.hint}
          value={typeof value === 'string' ? value : ''}
          rows={3}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : event.target.value)
          }}
        />
      ) : (
        <Field
          label={field.label}
          hint={field.hint}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : event.target.value)
          }}
        />
      )
    case 'choice':
    case 'yes_no':
      return (
        <Choice
          label={field.label}
          options={
            field.kind === 'choice'
              ? field.options
              : [
                  { value: 'true', label: 'Ja' },
                  { value: 'false', label: 'Nein' },
                ]
          }
          value={value === undefined ? null : String(value)}
          onChange={(picked) => {
            onChange(field.kind === 'yes_no' ? picked === 'true' : picked)
          }}
        />
      )
    case 'signature': {
      const given = (nextName: string, nextPath: string | null) => {
        onChange(
          nextName.trim() === '' || nextPath === null
            ? undefined
            : { name: nextName.trim(), path: nextPath, signedAt: new Date().toISOString() },
        )
      }

      return (
        <div className="flex flex-col gap-3">
          <Field
            label={visitWords.signerName}
            hint={visitWords.signerHint}
            value={name}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setName(event.target.value)
              given(event.target.value, path)
            }}
          />
          <div className="flex flex-col gap-2">
            <SiteLabel>{field.label}</SiteLabel>
            <SignaturePad
              label={field.label}
              onChange={(drawn) => {
                setPath(drawn)
                given(name, drawn)
              }}
            />
          </div>
        </div>
      )
    }
    default:
      return <SiteTrouble>{visitWords.notShown(field.label)}</SiteTrouble>
  }
}

/** How many fields of a form ask for an answer before it can be issued. */
function requiredOf(form: FormDefinition): number {
  return form.sections.reduce(
    (sum, section) => sum + section.fields.filter((field) => field.required === true).length,
    0,
  )
}

/** The permit for hot work, filled in on site in the version in force today. */
export function SiteWorkPermitScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const catalogue = useCatalogue()
  const { work, contractorId, briefs } = useBriefs(activityId)
  const [answers, setAnswers] = useState<Readonly<Record<string, unknown>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const back = { to: siteForms.form(activityId), label: 'Zurück zum Auftrag' }
  const form = permitFormOn(catalogue, today() as IsoDate)

  if (work.activity === null) {
    return <NotOnDevice what="Diesen Auftrag" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (!briefs || contractorId === null || form === null) {
    return (
      <NotOffered title={visitWords.permit} back={back}>
        {form === null
          ? visitWords.noForm
          : contractorId === null || !work.editable
            ? visitWords.notOffered
            : visitWords.who}
      </NotOffered>
    )
  }

  const filled = Object.fromEntries(
    Object.entries(answers).filter(([, value]) => value !== undefined),
  ) as FormValues
  const problems = permitAnswersProblems(form, filled)
  const total = requiredOf(form)

  async function grant() {
    if (problems.length > 0 || form === null || contractorId === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const problem = await issueWorkPermit(client, {
        activityId,
        contractorId,
        form,
        answers: filled,
      })

      if (problem !== null) {
        setTrouble(problem)

        return
      }

      void navigate({ to: back.to })
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SiteHeader
        title={visitWords.permit}
        sub={maybeText(work.order, 'number') ?? undefined}
        back={back}
      />
      <SiteScreen>
        <AnswerProgress
          done={Math.max(0, total - problems.length)}
          total={total}
          text={visitWords.version(form.version)}
        />
        <OrderOfVisit activityId={activityId} contractorId={contractorId} />
        {form.sections.map((section) => (
          <Panel key={section.key} title={section.title}>
            <div className="flex flex-col gap-3">
              {section.hint === undefined ? null : (
                <SiteText muted size={15}>
                  {section.hint}
                </SiteText>
              )}
              {section.fields.map((field) => (
                <PermitField
                  key={field.key}
                  field={field}
                  value={answers[field.key]}
                  onChange={(value) => {
                    setAnswers((before) => ({ ...before, [field.key]: value }))
                  }}
                />
              ))}
            </div>
          </Panel>
        ))}
        <SiteText muted>{visitWords.issued(who.name)}</SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={visitWords.grantThen}>
        <Button
          height={60}
          onClick={() => {
            void navigate({ to: back.to })
          }}
        >
          {visitWords.back}
        </Button>
        <Button
          tone="primary"
          height={60}
          icon={Signature}
          disabled={working || problems.length > 0}
          onClick={() => {
            void grant()
          }}
        >
          {visitWords.grant}
        </Button>
      </SiteActionBar>
    </>
  )
}
