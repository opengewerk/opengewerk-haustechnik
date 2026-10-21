import { type Catalogue, heldOf, type IsoDate, requiredKinds } from '@opengewerk/haustechnik-domain'
import { maybeText, text, useRecord, useRecords, useRelated } from '@opengewerk/platform-web/sync'
import { Button, Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { AnswerProgress, newBlockKey } from '@opengewerk/platform-web/forms'
import {
  SiteActionBar,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, Copy, Plus, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'

import {
  answerAt,
  filledOf,
  type FormPoint,
  isAnswered,
  isDemanded,
  type OpenedBlock,
} from '../../app/answers.js'
import { PointInput } from '../../app/form-points.js'
import { NotOnDevice, useAcross } from '../kit.js'
import { siteForms } from '../places.js'
import {
  SiteFormScreen,
  siteFormWords,
  Unshowable,
  useAboutWords,
  useActivityForm,
  useWhere,
} from './form.js'
import { EmptiedOnSite } from './emptied.js'
import { SiteStartScreen } from './start.js'

// The circuits of an installation in a group over them (#350) are fetched with
// the protocol that has one: the entry on site has a budget of 300 kB.
const CircuitsSection = lazy(async () => ({
  default: (await import('./protocol-circuits.js')).CircuitsSection,
}))
// So is the list of the assets of a collective activity (#342), for the same budget.
const SiteCollectiveScreen = lazy(async () => ({
  default: (await import('./collective.js')).SiteCollectiveScreen,
}))
// And the page of a work order with its material and the briefing of a
// contractor, and the result of an inspection with its signature (#502): the
// entry on site stood at its budget, and a round draws none of them.
const SiteWorkOrderScreen = lazy(async () => ({
  default: (await import('./work-order.js')).SiteWorkOrderScreen,
}))
const SiteResultScreen = lazy(async () => ({
  default: (await import('./result.js')).SiteResultScreen,
}))

export const protocolWords = {
  origin: (packageTitle: string | null, version: number) =>
    packageTitle === null
      ? `Formular in der Fassung ${String(version)}`
      : `Formular aus dem Paket ${packageTitle}, Fassung ${String(version)}`,
  template: (on: string) =>
    `Vorlage ist das Protokoll vom ${date(on)}: Angaben sind übernommen, Antworten und Messwerte werden neu erfasst.`,
  toResult: 'Weiter zum Ergebnis',
  back: 'Zurück',
  // The kind of qualification the duties ask for, which the person lacks (#337).
  lacking: (kind: string, ranOut: string | null) =>
    ranOut === null
      ? `Gefordert ist „${kind}“. Unter Ihren Qualifikationen steht sie nicht. Sagen Sie es der Leitung; weiterarbeiten können Sie trotzdem.`
      : `Gefordert ist „${kind}“. Unter Ihren Qualifikationen ist sie am ${date(ranOut)} abgelaufen. Sagen Sie es der Leitung; weiterarbeiten können Sie trotzdem.`,
} as const

/**
 * An activity on site by what it is (#108): a round shows its chapters and
 * points, one point to a screen (#107, #114), beside the list of the start on
 * a tablet held across; a work order its page with the notes (#118); an
 * inspection or a maintenance with a form its protocol as one list, the board
 * "Prüfung: Protokoll"; one without a form its result straight away, since it
 * has nothing else to say.
 */
export function SiteActivityScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const activity = useRecord('activities', activityId)
  const across = useAcross()

  if (activity === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  // Emptied with its last evidence (#409): what it was, and nothing more.
  if (maybeText(activity, 'emptiedAt') !== null) {
    return <EmptiedOnSite activity={activity} />
  }

  if (text(activity, 'kind') === 'round') {
    // On a tablet held across, the round stands beside the list of the start.
    return across ? <SiteStartScreen selected={activityId} /> : <SiteFormScreen />
  }

  if (text(activity, 'kind') === 'work_order') {
    return (
      <Suspense fallback={null}>
        <SiteWorkOrderScreen />
      </Suspense>
    )
  }

  // A collective activity, the list of its assets (#342).
  if (maybeText(activity, 'collectiveKind') !== null) {
    return (
      <Suspense fallback={null}>
        <SiteCollectiveScreen />
      </Suspense>
    )
  }

  return maybeText(activity, 'formKey') === null ? (
    <Suspense fallback={null}>
      <SiteResultScreen />
    </Suspense>
  ) : (
    <SiteProtocolScreen />
  )
}

/**
 * The protocol of an inspection or a maintenance on site, the board
 * "Prüfung: Protokoll (4.4)": the form of the duty kind in the version the
 * activity keeps, every point with its input in one list, section by
 * section, and where the last protocol of the asset was its template, the day
 * of it. Every input is on the device the moment it is given; the first one
 * begins the activity. "Weiter zum Ergebnis" leads to the result and the
 * signature.
 */
export function SiteProtocolScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const navigate = useNavigate()
  const [opened, setOpened] = useState<readonly OpenedBlock[]>([])
  const form = useActivityForm(activityId, opened)
  const where = useWhere(form.activity)
  const aboutWords = useAboutWords()
  const [trouble, setTrouble] = useState<string | null>(null)
  const packageTitle = useMemo(() => {
    const prefix = maybeText(form.activity, 'formKey')?.split('.')[0]

    return form.catalogue?.packages.find((each) => each.name === prefix)?.title ?? null
  }, [form.activity, form.catalogue])

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

  const definition = form.definition
  const context = form.context
  const activity = form.activity
  // The protocol of a work order stands under its page (#118).
  const back =
    text(activity, 'kind') === 'work_order'
      ? { to: siteForms.form(activityId), label: 'Zurück zum Auftrag' }
      : where.back
  const filledAt = (point: FormPoint) => {
    const record = answerAt(form.answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  const demanded = form.points.filter(isDemanded)
  const counted = demanded.length > 0 ? demanded : form.points
  const done = counted.filter((point) => isAnswered(point, filledAt(point))).length
  const templateOn = maybeText(activity, 'templateOn')

  return (
    <>
      <SiteHeader title={title} sub={where.words} back={back} />
      <SiteScreen>
        {form.editable ? (
          <OwnQualification activityId={activityId} catalogue={form.catalogue} />
        ) : null}
        <AnswerProgress
          done={done}
          total={counted.length}
          text={protocolWords.origin(packageTitle, definition.version)}
        />
        {templateOn === null ? null : (
          <p className="flex gap-2.5 rounded-[6px] border border-line bg-surface-sunken px-3.5 py-3 text-[15px] leading-[1.4]">
            <Copy
              size={20}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
            <span>{protocolWords.template(templateOn)}</span>
          </p>
        )}
        {form.open ? null : <SiteText muted>{siteFormWords.closed}</SiteText>}
        {form.open && !form.performs ? <SiteText muted>{siteFormWords.mayNot}</SiteText> : null}
        {definition.sections.map((section) => {
          // The blocks of the circuits stand as their cards, each opening its block (#350).
          const inSection = form.points.filter(
            (point) => point.section.key === section.key && point.group?.repeat !== 'circuits',
          )
          const sectionDemanded = inSection.filter(isDemanded)
          const groups = section.fields.filter((field) => field.kind === 'group')

          if (inSection.length === 0 && groups.length === 0) {
            return null
          }

          const list = (
            <ul aria-label={section.title} className="flex flex-col">
              {inSection.map((point, index) => {
                const firstOfBlock =
                  point.group !== null &&
                  point.block !== null &&
                  inSection[index - 1]?.blockKey !== point.blockKey

                return (
                  <li
                    key={point.key}
                    className="flex flex-col gap-2 border-b border-row py-2.5 last:border-b-0"
                  >
                    {firstOfBlock && point.group !== null && point.block !== null ? (
                      <p className="font-condensed text-[14px] font-semibold tracking-[1px] text-ink-faint uppercase">
                        {siteFormWords.block(point.group.label, point.block)}
                      </p>
                    ) : null}
                    <PointInput
                      activityId={activityId}
                      propertyId={text(activity, 'propertyId')}
                      point={point}
                      answer={answerAt(form.answers, point)}
                      context={context}
                      target={aboutWords(point) ?? where.words}
                      editable={form.editable}
                      layout="list"
                      onTrouble={setTrouble}
                    />
                  </li>
                )
              })}
            </ul>
          )

          if (groups.some((group) => group.kind === 'group' && group.repeat === 'circuits')) {
            return (
              <Suspense key={section.key} fallback={null}>
                <CircuitsSection
                  activityId={activityId}
                  assetId={maybeText(activity, 'assetId')}
                  section={section}
                  points={form.points}
                  answers={form.answers}
                  context={context}
                  circuits={form.circuits}
                >
                  {inSection.length === 0 ? null : list}
                </CircuitsSection>
              </Suspense>
            )
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
              {list}
              {form.editable
                ? groups.map((group) =>
                    group.kind === 'group' && group.repeat === 'free' ? (
                      <div key={group.key} className="pt-3">
                        <Button
                          icon={Plus}
                          height={52}
                          wide
                          onClick={() => {
                            setOpened([...opened, { groupKey: group.key, blockKey: newBlockKey() }])
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
        })}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={siteFormWords.saved}>
        <div className="min-w-0 flex-1">
          <Button
            wide
            height={60}
            icon={ChevronLeft}
            onClick={() => {
              void navigate({ to: back.to })
            }}
          >
            {protocolWords.back}
          </Button>
        </div>
        <div className="min-w-0 flex-[2]">
          <Button
            tone="primary"
            wide
            height={60}
            onClick={() => {
              void navigate({ to: siteForms.result(activityId) })
            }}
          >
            {protocolWords.toResult}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}

/**
 * Beginning an activity whose duties ask for a kind of qualification the
 * person does not hold, or holds no longer (#337): told, and not stopped.
 * The device holds the own qualifications and nobody else's.
 */
function OwnQualification({
  activityId,
  catalogue,
}: {
  readonly activityId: string
  readonly catalogue: Catalogue | null
}) {
  const lines = useRelated('activity_duties', 'activityId', activityId)
  const duties = useRecords('duties')
  const held = useRecords('qualifications')

  if (catalogue === null) {
    return null
  }

  const kinds = requiredKinds(
    catalogue,
    lines.map((line) =>
      maybeText(duties.find((duty) => duty['id'] === line['dutyId']) ?? null, 'kind'),
    ),
  )
  const own = held.map((row) => ({
    kindKey: maybeText(row, 'kindKey'),
    ownKindId: maybeText(row, 'ownKindId'),
    validUntil: maybeText(row, 'validUntil') as IsoDate | null,
    deletedAt: (row['deletedAt'] as string | null | undefined) ?? null,
  }))
  const day = today()

  for (const kind of kinds) {
    // A kind that covers the one asked for counts as it (#406).
    const { check, expiredOn } = heldOf(own, kind, day)

    if (check !== 'held') {
      return (
        <p
          role="note"
          className="flex gap-2.5 rounded-[6px] border border-waiting-edge bg-waiting-fill px-3.5 py-3 text-[15px] leading-[1.4]"
        >
          <TriangleAlert
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            className="shrink-0 text-waiting"
          />
          <span>{protocolWords.lacking(kind.label, expiredOn)}</span>
        </p>
      )
    }
  }

  return null
}
