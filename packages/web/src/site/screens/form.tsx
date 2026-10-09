import {
  type FormDefinition,
  type IsoDate,
  type LimitContext,
  type RecordState,
  weekdayLabel,
  weekdayOf,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { AnswerMark, AnswerProgress, newBlockKey } from '@opengewerk/platform-web/forms'
import { date, today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteLabel,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
  type WayBack,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, ClipboardCheck, DoorOpen, Plus, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  answerAt,
  filledOf,
  type FormPoint,
  isAnswered,
  isDemanded,
  openedBy,
  type OpenedBlock,
  pointKey,
  pointsOf,
  pointState,
} from '../../app/answers.js'
import { fulfilledDuty, useDutyName, useFormOf } from '../../app/form-of.js'
import { askedAsQuestion, PointInput } from '../../app/form-points.js'
import { titleOfRoom } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { assetTitle, NotOffered, NotOnDevice } from '../kit.js'
import { siteForms, sitePlaces } from '../places.js'

export const siteFormWords = {
  saved: 'Jede Eingabe ist sofort auf dem Gerät gesichert, auch ohne Netz.',
  noCatalogue:
    'Den Katalog hält dieses Gerät noch nicht, und mit ihm das Formular. Er kommt mit dem nächsten Abgleich.',
  noForm: 'Dieser Vorgang hat kein Formular.',
  unknownVersion:
    'Das Formular dieses Vorgangs liegt in einer Fassung vor, die dieses Gerät nicht kennt. Nach dem nächsten Abgleich mit einer neueren Fassung der Anwendung lässt es sich ausfüllen.',
  closed: 'Dieser Vorgang ist abgeschlossen. Seine Antworten lassen sich nicht mehr ändern.',
  mayNot: 'Antworten geben gehört nicht zu den Rechten dieses Zugangs.',
  noPoint: 'Diesen Punkt hat das Formular nicht.',
  demanded: (done: number, total: number) =>
    `${String(done)} von ${String(total)} Pflichtpunkten beantwortet`,
  answered: (done: number, total: number) =>
    `${String(done)} von ${String(total)} Punkten beantwortet`,
  optional: 'freiwillig',
  point: (at: number, of: number) => `Punkt ${String(at)} von ${String(of)}`,
  block: (label: string, at: number) => `${label} ${String(at)}`,
  addBlock: (label: string) => `${label} hinzufügen`,
  next: (where: string) => `Weiter: ${where}`,
  back: 'Zurück',
  forward: 'Weiter',
  overview: 'Zur Übersicht',
  toHandIn: 'Zur Abgabe',
  round: 'Rundgang',
  version: (version: number) => `Fassung ${String(version)}`,
  fulfils: (duty: string) => `erfüllt ${duty}`,
} as const

/** The way back from a round and what follows it: the start, where it was chosen. */
export const toStart: WayBack = { to: '/', label: 'Zurück zum Start' }

/** The statuses in which the answers of an activity may still be given (the sync asks the same). */
export const inProgress = ['open', 'started']

/** Where an activity is, in words, and the page it is at on site. */
export function useWhere(activity: RecordState | null): {
  readonly words: string
  readonly back: WayBack
} {
  const asset = useRecord('assets', maybeText(activity, 'assetId') ?? undefined)
  const room = useRecord('rooms', maybeText(activity, 'roomId') ?? undefined)
  const building = useRecord('buildings', maybeText(activity, 'buildingId') ?? undefined)
  const property = useRecord('properties', maybeText(activity, 'propertyId') ?? undefined)

  if (asset) {
    return {
      words: assetTitle(asset),
      back: { to: sitePlaces.asset(String(asset['id'])), label: 'Zurück zur Anlage' },
    }
  }

  if (room) {
    return {
      words: `Raum ${titleOfRoom(room)}`,
      back: { to: sitePlaces.room(String(room['id'])), label: 'Zurück zum Raum' },
    }
  }

  if (building) {
    return {
      words: text(building, 'name'),
      back: { to: sitePlaces.building(String(building['id'])), label: 'Zurück zum Gebäude' },
    }
  }

  return {
    words: text(property, 'name'),
    back: {
      to: sitePlaces.property(maybeText(activity, 'propertyId') ?? ''),
      label: 'Zurück zur Liegenschaft',
    },
  }
}

/** What a point is about, in words: the asset or room its field names, or else the place of the activity. */
export function useAboutWords(): (point: FormPoint) => string | null {
  const assets = useRecords('assets')
  const rooms = useRecords('rooms')

  return (point) => {
    const about = point.field.about

    if (about === undefined) {
      return null
    }

    if (about.kind === 'asset') {
      const asset = assets.find((candidate) => candidate['id'] === about.id)

      return asset ? assetTitle(asset) : null
    }

    const room = rooms.find((candidate) => candidate['id'] === about.id)

    return room ? `Raum ${titleOfRoom(room)}` : null
  }
}

/**
 * The form of an activity on this device, its answers, and what may be done
 * with them: nothing more once it is signed here, before the server has
 * answered (#108).
 */
export function useActivityForm(activityId: string, opened: readonly OpenedBlock[]) {
  const activity = useRecord('activities', activityId)
  const catalogue = useCatalogue()
  const answers = useRelated('activity_answers', 'activityId', activityId)
  const client = useSync()
  const status = text(activity, 'status')
  // A work order the office turned back is open again, with its signature
  // standing and no longer counting (#118): there a signature counts while it
  // waits in the outbox, or once the server says so with the state.
  const signed = useRelated('activity_signatures', 'activityId', activityId).some(
    (signature) =>
      signature['role'] === 'signer' &&
      (text(activity, 'kind') !== 'work_order' ||
        !inProgress.includes(status) ||
        client.isPending('activity_signatures', String(signature['id']))),
  )
  const performs = useRight('activity.perform')
  const form = useFormOf(
    maybeText(activity, 'formKey'),
    typeof activity?.['formVersion'] === 'number' ? activity['formVersion'] : null,
  )
  const definition: FormDefinition | null | undefined = activity === null ? null : form
  const filled = useMemo(() => answers.map(filledOf), [answers])
  const points = useMemo(
    () => (definition ? pointsOf(definition, filled, opened) : []),
    [definition, filled, opened],
  )
  const context: LimitContext | null =
    catalogue === null
      ? null
      : { rules: catalogue.ruleSet, on: maybeText(activity, 'performedOn') ?? today() }
  const open = inProgress.includes(status) && !signed

  return {
    activity,
    catalogue,
    definition,
    answers,
    points,
    context,
    open,
    signed,
    performs,
    editable: open && performs,
  }
}

/** In place of the form, where the device cannot show it: no catalogue, no form, a version it does not know. */
export function Unshowable({
  title,
  back,
  catalogue,
  definition,
}: {
  readonly title: string
  readonly back: WayBack
  readonly catalogue: unknown
  readonly definition: FormDefinition | null | undefined
}) {
  return (
    <NotOffered title={title} back={back}>
      {catalogue === null
        ? siteFormWords.noCatalogue
        : definition === undefined
          ? siteFormWords.unknownVersion
          : siteFormWords.noForm}
    </NotOffered>
  )
}

/** How far the points of a form are: those that have to be answered, else all, and the first still open. */
export function progressOf(points: readonly FormPoint[], answers: readonly RecordState[]) {
  const filledAt = (point: FormPoint) => {
    const record = answerAt(answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  const demanded = points.filter(isDemanded)
  const counted = demanded.length > 0 ? demanded : points
  const nextOpen =
    demanded.find((point) => !isAnswered(point, filledAt(point))) ??
    points.find((point) => !isAnswered(point, filledAt(point)))

  return {
    done: counted.filter((point) => isAnswered(point, filledAt(point))).length,
    total: counted.length,
    demanded: demanded.length > 0,
    nextOpen,
    filledAt,
  }
}

/** "Montag, 05.10.2026 · Schulhaus": the day of a round and where it is, under its title. */
export function roundSub(activity: RecordState, where: string): string {
  const dueOn = maybeText(activity, 'dueOn') as IsoDate | null

  return [dueOn === null ? null : `${weekdayLabel[weekdayOf(dueOn)]}, ${date(dueOn)}`, where]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The round on site, `rundgang()` of the boards (4.5 of the concept, #107,
 * #114): its title over its day and where it is, its chapters with their
 * points, each with its answer or "offen", and how many of those that have
 * to be answered are. A point opens on a screen of its own; "Weiter" leads to
 * the first one still open, and once none is, to the handing in.
 */
export function SiteFormScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }

  return <RoundOverview key={activityId} activityId={activityId} />
}

/**
 * The round with its chapters and points. On a phone it is a screen of its
 * own, with the header and the bar at the foot; `pane` draws it beside the
 * list on a tablet held across, the board "Tablet quer": its head and its
 * button in the pane, the chapters two by two.
 */
export function RoundOverview({
  activityId,
  pane = false,
}: {
  readonly activityId: string
  readonly pane?: boolean
}) {
  const navigate = useNavigate()
  const form = useActivityForm(activityId, [])
  const where = useWhere(form.activity)
  const aboutWords = useAboutWords()

  if (form.activity === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  const title = text(form.activity, 'title')

  if (!form.definition || form.context === null) {
    return (
      <Unshowable
        title={title}
        back={where.back}
        catalogue={form.catalogue}
        definition={form.definition}
      />
    )
  }

  const context = form.context
  const progress = progressOf(form.points, form.answers)
  const { filledAt, nextOpen } = progress
  const definition = form.definition
  const sub = roundSub(form.activity, where.words)
  const onward = (
    <Button
      tone="primary"
      wide={!pane}
      height={pane ? 56 : 60}
      icon={ChevronRight}
      onClick={() => {
        void navigate({
          to:
            nextOpen && form.open
              ? siteForms.point(activityId, nextOpen.key)
              : siteForms.handIn(activityId),
        })
      }}
    >
      {nextOpen && form.open ? siteFormWords.next(nextOpen.section.title) : siteFormWords.toHandIn}
    </Button>
  )
  const sections = definition.sections.map((section) => {
    const inSection = form.points.filter((point) => point.section.key === section.key)
    const sectionDemanded = inSection.filter(isDemanded)
    const groups = section.fields.filter((field) => field.kind === 'group')

    if (inSection.length === 0 && groups.length === 0) {
      return null
    }

    return (
      <Panel
        key={section.key}
        title={section.title}
        action={
          sectionDemanded.length === 0 ? undefined : (
            <span className="text-[15px] text-ink-muted tabular-nums">
              {`${String(sectionDemanded.filter((point) => isAnswered(point, filledAt(point))).length)} von ${String(sectionDemanded.length)}`}
            </span>
          )
        }
      >
        <SiteRows label={section.title}>
          {inSection.map((point) => (
            <SiteRow
              key={point.key}
              to={siteForms.point(activityId, point.key)}
              title={
                point.group === null || point.block === null
                  ? point.field.label
                  : `${point.field.label}, ${siteFormWords.block(point.group.label, point.block)}`
              }
              meta={aboutWords(point) ?? (isDemanded(point) ? undefined : siteFormWords.optional)}
              right={<AnswerMark state={pointState(point, filledAt(point), context)} />}
            />
          ))}
        </SiteRows>
        {form.editable
          ? groups.map((group) =>
              group.kind === 'group' && group.repeat === 'free' && group.fields[0] ? (
                <div key={group.key} className="pt-3">
                  <Button
                    icon={Plus}
                    height={52}
                    wide
                    onClick={() => {
                      void navigate({
                        to: siteForms.point(
                          activityId,
                          pointKey(group.key, newBlockKey(), group.fields[0]?.key ?? ''),
                        ),
                      })
                    }}
                  >
                    {siteFormWords.addBlock(group.label)}
                  </Button>
                </div>
              ) : null,
            )
          : null}
      </Panel>
    )
  })
  const answered = (
    <AnswerProgress
      done={progress.done}
      total={progress.total}
      text={
        progress.demanded
          ? siteFormWords.demanded(progress.done, progress.total)
          : siteFormWords.answered(progress.done, progress.total)
      }
    />
  )

  if (pane) {
    return (
      <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
        <div>
          <SiteLabel>{siteFormWords.round}</SiteLabel>
          <h2 className="mt-0.5 text-[26px] leading-[1.2] font-bold [overflow-wrap:anywhere]">
            {title}
          </h2>
          <p className="mt-0.5 text-[16px] text-ink-muted">
            {[sub, siteFormWords.version(definition.version)].join(' · ')}
          </p>
        </div>
        {answered}
        {form.open ? null : <SiteText muted>{siteFormWords.closed}</SiteText>}
        <div className="grid grid-cols-2 items-start gap-3">{sections}</div>
        <div className="flex justify-end">{onward}</div>
      </div>
    )
  }

  return (
    <>
      <SiteHeader title={title} sub={sub} back={toStart} />
      <SiteScreen>
        {answered}
        {form.open ? null : <SiteText muted>{siteFormWords.closed}</SiteText>}
        {sections}
      </SiteScreen>
      <SiteActionBar note={form.open ? siteFormWords.saved : undefined}>{onward}</SiteActionBar>
    </>
  )
}

/**
 * One point of a form on a screen of its own, the boards "Prüfpunkt",
 * "Nicht in Ordnung", "Nicht möglich" and "Messwert außerhalb des
 * Grenzwerts" (4.5 of the concept, #107): the question, what it is about, the input of its kind and what the
 * signature will make of the answer. Every input is written as it is given;
 * "Zurück" and "Weiter" go from point to point and, at either end, to the
 * form.
 */
export function SitePointScreen() {
  const { activityId, pointKey: key } = useParams({ strict: false }) as {
    activityId: string
    pointKey: string
  }
  const navigate = useNavigate()
  const opened = useMemo(() => {
    const block = openedBy(key)

    return block === null ? [] : [block]
  }, [key])
  const form = useActivityForm(activityId, opened)
  const where = useWhere(form.activity)
  const aboutWords = useAboutWords()
  const [trouble, setTrouble] = useState<string | null>(null)
  const toForm: WayBack = { to: siteForms.form(activityId), label: 'Zurück zum Formular' }
  const duty = useDutyName(
    fulfilledDuty(form.points.find((each) => each.key === key)?.field ?? null),
  )

  if (form.activity === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (!form.definition || form.context === null) {
    return (
      <Unshowable
        title={text(form.activity, 'title')}
        back={toForm}
        catalogue={form.catalogue}
        definition={form.definition}
      />
    )
  }

  const at = form.points.findIndex((point) => point.key === key)
  const point = form.points[at]

  if (point === undefined) {
    return (
      <NotOffered title={text(form.activity, 'title')} back={toForm}>
        {siteFormWords.noPoint}
      </NotOffered>
    )
  }

  const before = form.points[at - 1]
  const after = form.points[at + 1]
  // The end of a round is its handing in (#114); every other form goes back to itself.
  const round = text(form.activity, 'kind') === 'round'
  const target = aboutWords(point) ?? where.words
  const question = askedAsQuestion(point.field.kind)
  const AboutIcon =
    point.field.about?.kind === 'asset' || maybeText(form.activity, 'assetId') ? Zap : DoorOpen

  return (
    <>
      <SiteHeader
        title={
          point.group === null || point.block === null
            ? point.section.title
            : siteFormWords.block(point.group.label, point.block)
        }
        sub={siteFormWords.point(at + 1, form.points.length)}
        back={toForm}
      />
      <SiteScreen gap={14}>
        <div>
          {question ? (
            <h2 className="text-[22px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
              {point.field.label}
            </h2>
          ) : null}
          <p className="mt-1 flex items-center gap-1.5 text-[15px] text-ink-muted">
            <AboutIcon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            {target}
          </p>
          {duty === null ? null : (
            <p className="mt-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-done">
              <ClipboardCheck size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
              {siteFormWords.fulfils(duty)}
            </p>
          )}
        </div>
        {form.open ? null : <SiteText muted>{siteFormWords.closed}</SiteText>}
        {form.open && !form.performs ? <SiteText muted>{siteFormWords.mayNot}</SiteText> : null}
        <PointInput
          key={point.key}
          activityId={activityId}
          propertyId={text(form.activity, 'propertyId')}
          point={point}
          answer={answerAt(form.answers, point)}
          context={form.context}
          target={target}
          duty={duty}
          editable={form.editable}
          onTrouble={setTrouble}
        />
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar>
        <div className="min-w-0 flex-1">
          <Button
            wide
            height={60}
            icon={ChevronLeft}
            onClick={() => {
              void navigate({
                to: before ? siteForms.point(activityId, before.key) : siteForms.form(activityId),
              })
            }}
          >
            {siteFormWords.back}
          </Button>
        </div>
        <div className="min-w-0 flex-[2]">
          <Button
            tone="primary"
            wide
            height={60}
            onClick={() => {
              void navigate({
                to: after
                  ? siteForms.point(activityId, after.key)
                  : round
                    ? siteForms.handIn(activityId)
                    : siteForms.form(activityId),
              })
            }}
          >
            {after
              ? siteFormWords.forward
              : round
                ? siteFormWords.toHandIn
                : siteFormWords.overview}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}
