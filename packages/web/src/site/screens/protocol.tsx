import { maybeText, text, useRecord } from '@opengewerk/platform-web/sync'
import { Button, Panel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { AnswerProgress, newBlockKey } from '@opengewerk/platform-web/forms'
import {
  SiteActionBar,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, Copy, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

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
import { SiteResultScreen } from './result.js'
import { SiteStartScreen } from './start.js'

export const protocolWords = {
  origin: (packageTitle: string | null, version: number) =>
    packageTitle === null
      ? `Formular in der Fassung ${String(version)}`
      : `Formular aus dem Paket ${packageTitle}, Fassung ${String(version)}`,
  template: (on: string) =>
    `Vorlage ist das Protokoll vom ${date(on)}: Angaben sind übernommen, Antworten und Messwerte werden neu erfasst.`,
  toResult: 'Weiter zum Ergebnis',
  back: 'Zurück',
} as const

/**
 * An activity on site by what it is (#108): a round shows its chapters and
 * points, one point to a screen (#107, #114), beside the list of the start on
 * a tablet held across; an inspection or a maintenance
 * with a form its protocol as one list, the board "Prüfung: Protokoll"; one
 * without a form its result straight away, since it has nothing else to say.
 */
export function SiteActivityScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const activity = useRecord('activities', activityId)
  const across = useAcross()

  if (activity === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (text(activity, 'kind') === 'round') {
    // On a tablet held across, the round stands beside the list of the start.
    return across ? <SiteStartScreen selected={activityId} /> : <SiteFormScreen />
  }

  return maybeText(activity, 'formKey') === null ? <SiteResultScreen /> : <SiteProtocolScreen />
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
      <SiteHeader title={title} sub={where.words} back={where.back} />
      <SiteScreen>
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
              void navigate({ to: where.back.to })
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
