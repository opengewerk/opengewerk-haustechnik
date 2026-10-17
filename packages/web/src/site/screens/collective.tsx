import {
  activityUnderWay,
  byNameIn,
  evidenceResultLabel,
  type EvidenceResult,
  partHasItsResult,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel, Status, type StatusTone, statusIcons } from '@opengewerk/platform-web'
import { clockTime } from '@opengewerk/platform-web/format'
import { AnswerProgress } from '@opengewerk/platform-web/forms'
import { useWho } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
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
import { Check, ChevronLeft, ScanLine, Signature } from 'lucide-react'
import { useState } from 'react'

import { failureSentence } from '../../app/failure.js'
import { titleOfRoom } from '../../app/place-records.js'
import { type GivenSignature, SignatureWays } from '../../app/signature-ways.js'
import { signActivity } from '../../app/signing.js'
import { NotOnDevice } from '../kit.js'
import { siteForms } from '../places.js'

export const collectiveSiteWords = {
  mark: 'Sammelvorgang',
  parts: 'Anlagen',
  count: (parts: number) => (parts === 1 ? '1 Anlage' : `${String(parts)} Anlagen`),
  withResult: (done: number, of: number) => `${String(done)} von ${String(of)} mit Ergebnis`,
  scan: 'Etikett scannen',
  open: 'offen',
  begun: 'begonnen',
  unreachable:
    'Jede Anlage hat ihr Protokoll. Eine, die nicht erreichbar ist, bekommt „nicht durchgeführt“ mit Grund; die übrigen gehen weiter.',
  toSign: 'Weiter zur Unterschrift',
  signOnce: 'Unterschrieben wird einmal, für alle Anlagen.',
  stillWithout: (count: number) =>
    `Unterschrieben wird, wenn jede Anlage ein Ergebnis hat. Noch ${String(count)} ohne.`,
  // The signature under the list.
  signTitle: 'Unterschreiben',
  whatYouSign: 'Was Sie unterschreiben',
  follows: 'Daraus folgt',
  evidence: (count: number) =>
    count === 1
      ? '1 Nachweis, für die eine Pflicht.'
      : `${String(count)} Nachweise, einer je Pflicht.`,
  keeps: (assets: string) => `Nicht durchgeführt: ${assets}. Ihr Termin bleibt, wie er ist.`,
  signature: 'Unterschrift',
  pad: 'Feld für die Unterschrift',
  sign: 'Unterschreiben',
  signNote: (count: number) =>
    `Die Unterschrift gilt für genau diese Seite und steht in jedem der ${String(count)} Nachweise.`,
  notYet: 'Unterschrieben wird, wenn jede Anlage ein Ergebnis hat.',
  mayNot: 'Unterschreiben kann, wer diesen Sammelvorgang ausführt.',
  signed: 'Unterschrieben',
  waits: 'Mit der Übertragung entstehen die Nachweise, und die Termine rücken weiter.',
  written: 'Die Nachweise sind entstanden, und die Termine rücken weiter.',
  signedAt: (at: string, sent: boolean) =>
    `unterschrieben um ${at}, ${sent ? 'übertragen' : 'wartet auf die Übertragung'}`,
  closed: 'Dieser Sammelvorgang ist geschlossen. Was er hielt, lässt sich nicht mehr ändern.',
  toList: 'Zur Liste',
  toStart: 'Zum Start',
} as const

/** Whether a record is there and not marked. */
function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

const resultTones: Readonly<Record<EvidenceResult, StatusTone>> = {
  without_defects: 'done',
  with_defects: 'waiting',
  failed: 'conflict',
  not_performed: 'neutral',
}

/** The result of a part as the list shows it: in its tone, or "offen" and "begonnen" while it has none. */
function PartMark({
  part,
  lines,
}: {
  readonly part: RecordState
  readonly lines: readonly RecordState[]
}) {
  const result = maybeText(lines[0], 'result') as EvidenceResult | null

  if (result === null || !partHasItsResult(lines.map(resultOf))) {
    return (
      <span className="shrink-0 text-[15px] font-semibold whitespace-nowrap text-ink-faint">
        {text(part, 'status') === 'started' ? collectiveSiteWords.begun : collectiveSiteWords.open}
      </span>
    )
  }

  return (
    <Status
      tone={resultTones[result]}
      {...(result === 'not_performed' ? { icon: statusIcons.ban } : {})}
    >
      {evidenceResultLabel[result]}
    </Status>
  )
}

/** The result of a line of a duty, as the device holds it. */
function resultOf(line: RecordState) {
  return {
    result: maybeText(line, 'result') as EvidenceResult | null,
    resultReason: maybeText(line, 'resultReason'),
  }
}

/**
 * The parts of a collective activity as the device holds them, each with the
 * lines of its duties and what it is called: the asset by number and name,
 * and below it the floor and the room.
 */
function useParts(collectiveId: string) {
  const parts = useRelated('activities', 'collectiveId', collectiveId).filter(live)
  const lines = useRecords('activity_duties')
  const assets = useRecords('assets')
  const rooms = useRecords('rooms')
  const floors = useRecords('floors')
  const find = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)

  return parts
    .map((part) => {
      const asset = find(assets, maybeText(part, 'assetId'))
      const room = find(rooms, maybeText(asset, 'roomId') ?? maybeText(part, 'roomId'))
      const floor = find(floors, maybeText(room, 'floorId'))

      return {
        part,
        id: String(part['id']),
        lines: lines.filter((line) => line['activityId'] === part['id'] && live(line)),
        title:
          asset === null
            ? text(part, 'title')
            : [maybeText(asset, 'number'), maybeText(asset, 'name')].filter(Boolean).join(' '),
        where: [maybeText(floor, 'name'), room === null ? null : titleOfRoom(room)]
          .filter(Boolean)
          .join(', '),
      }
    })
    .sort((left, right) => byNameIn(left.where, right.where) || byNameIn(left.title, right.title))
}

/**
 * A collective activity on site, the board "Sammelvorgang: die Anlagen (4.4)"
 * (#342): its assets as a list, each with its result, and how many have one.
 * Each asset leads to its protocol, and the label of an asset leads there as
 * well, over the page of the asset. Once every asset has a result, it is
 * signed once, under the list. Also without a network: everything is on the
 * device.
 */
export function SiteCollectiveScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const navigate = useNavigate()
  const activity = useRecord('activities', activityId)
  const parts = useParts(activityId)

  if (activity === null) {
    return <NotOnDevice what="Diesen Sammelvorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  const withResult = parts.filter(
    ({ part, lines }) => text(part, 'status') === 'done' || partHasItsResult(lines.map(resultOf)),
  ).length
  const underWay = (activityUnderWay as readonly string[]).includes(text(activity, 'status'))
  const signed = text(activity, 'status') === 'signed' || text(activity, 'status') === 'done'
  const ready = parts.length > 0 && withResult === parts.length

  return (
    <>
      <SiteHeader
        title={text(activity, 'title')}
        sub={`${collectiveSiteWords.mark} · ${collectiveSiteWords.count(parts.length)}`}
        back={{ to: '/', label: collectiveSiteWords.toStart }}
      />
      <SiteScreen>
        <AnswerProgress
          done={withResult}
          total={parts.length}
          text={collectiveSiteWords.withResult(withResult, parts.length)}
        />
        {underWay && !signed ? (
          <Button
            icon={ScanLine}
            wide
            height={52}
            onClick={() => {
              void navigate({ to: '/scannen' })
            }}
          >
            {collectiveSiteWords.scan}
          </Button>
        ) : null}
        <Panel title={collectiveSiteWords.parts}>
          <SiteRows label={collectiveSiteWords.parts}>
            {parts.map(({ part, id, lines, title, where }) => (
              <SiteRow
                key={id}
                to={siteForms.form(id)}
                title={title}
                meta={where === '' ? undefined : where}
                right={<PartMark part={part} lines={lines} />}
              />
            ))}
          </SiteRows>
        </Panel>
        {underWay ? (
          <SiteText muted size={15}>
            {collectiveSiteWords.unreachable}
          </SiteText>
        ) : (
          <SiteText muted size={15}>
            {collectiveSiteWords.closed}
          </SiteText>
        )}
      </SiteScreen>
      {underWay ? (
        <SiteActionBar
          note={
            signed
              ? undefined
              : ready
                ? collectiveSiteWords.signOnce
                : collectiveSiteWords.stillWithout(parts.length - withResult)
          }
        >
          <Button
            tone="primary"
            wide
            height={60}
            icon={Signature}
            disabled={!ready}
            onClick={() => {
              void navigate({ to: siteForms.sign(activityId) })
            }}
          >
            {collectiveSiteWords.toSign}
          </Button>
        </SiteActionBar>
      ) : null}
    </>
  )
}

/**
 * The one signature of a collective activity, the board "Sammelvorgang: eine
 * Unterschrift für alle (4.4)" (decision of 15.10.2026): the page names every
 * asset with its result, says what follows, and is signed once. Each duty
 * gets its own evidence, which names this signature, when it reaches the
 * server.
 */
export function SiteCollectiveSignScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const activity = useRecord('activities', activityId)
  const parts = useParts(activityId)
  const signatures = useRelated('activity_signatures', 'activityId', activityId)
  const [given, setGiven] = useState<GivenSignature | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  if (activity === null) {
    return <NotOnDevice what="Diesen Sammelvorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  const back = { to: siteForms.form(activityId), label: collectiveSiteWords.toList }
  const signature = signatures
    .filter((each) => each['role'] === 'signer')
    .sort((left, right) => (text(left, 'signedAt') < text(right, 'signedAt') ? 1 : -1))[0]

  if (signature !== undefined || text(activity, 'status') === 'done') {
    const pending =
      signature !== undefined && client.isPending('activity_signatures', String(signature['id']))
    const signedAt = signature === undefined ? null : maybeText(signature, 'signedAt')

    return (
      <>
        <SiteHeader
          title={collectiveSiteWords.signTitle}
          sub={text(activity, 'title')}
          back={back}
        />
        <SiteScreen>
          <div className="rounded-[8px] border border-done-edge bg-done-fill px-4 py-5 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-done text-on-status">
              <Check size={30} strokeWidth={3} aria-hidden="true" />
            </span>
            <h2 className="mt-2.5 text-[22px] font-bold text-done">{collectiveSiteWords.signed}</h2>
            <p className="mt-1 text-[16px] leading-[1.4] text-ink">
              {text(activity, 'status') === 'done'
                ? collectiveSiteWords.written
                : collectiveSiteWords.waits}
            </p>
            {signedAt === null ? null : (
              <p className="mt-1.5 text-[14px] text-ink-muted">
                {collectiveSiteWords.signedAt(clockTime(new Date(signedAt)), !pending)}
              </p>
            )}
          </div>
        </SiteScreen>
        <SiteActionBar>
          <Button
            tone="dark"
            wide
            height={60}
            icon={ChevronLeft}
            onClick={() => {
              void navigate({ to: '/' })
            }}
          >
            {collectiveSiteWords.toStart}
          </Button>
        </SiteActionBar>
      </>
    )
  }

  const ready =
    parts.length > 0 &&
    parts.every(
      ({ part, lines }) => text(part, 'status') === 'done' || partHasItsResult(lines.map(resultOf)),
    )
  const notPerformed = parts.filter(({ lines }) =>
    lines.every((line) => maybeText(line, 'result') === 'not_performed'),
  )
  const duties = parts.reduce((sum, { lines }) => sum + lines.length, 0)
  const canSign = ready && given !== null && !working

  async function sign() {
    if (given === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const problem = await signActivity(client, activityId, given)

      if (problem !== null) {
        setTrouble(problem)
      }
    } catch {
      setTrouble(failureSentence())
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SiteHeader title={collectiveSiteWords.signTitle} sub={text(activity, 'title')} back={back} />
      <SiteScreen>
        <Panel
          title={collectiveSiteWords.whatYouSign}
          action={
            <span className="text-[15px] text-ink-muted">
              {collectiveSiteWords.count(parts.length)}
            </span>
          }
        >
          <ul aria-label={collectiveSiteWords.whatYouSign} className="flex flex-col">
            {parts.map(({ part, id, lines, title, where }) => (
              <li
                key={id}
                className="flex min-h-14 items-center gap-2.5 border-b border-line py-2 last:border-b-0"
              >
                <div className="min-w-0 grow">
                  <p className="text-[17px] font-medium [overflow-wrap:anywhere]">{title}</p>
                  {where === '' ? null : <p className="text-[15px] text-ink-muted">{where}</p>}
                </div>
                <PartMark part={part} lines={lines} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={collectiveSiteWords.follows}>
          <div className="flex flex-col gap-2">
            <SiteText size={16}>{collectiveSiteWords.evidence(duties)}</SiteText>
            {notPerformed.length === 0 ? null : (
              <SiteText size={16}>
                {collectiveSiteWords.keeps(notPerformed.map((each) => each.title).join(', '))}
              </SiteText>
            )}
          </div>
        </Panel>
        {ready ? (
          <div className="flex flex-col gap-1.5">
            <p className="font-condensed text-[15px] font-semibold tracking-[1.2px] text-ink-faint uppercase">
              {collectiveSiteWords.signature}
            </p>
            <SignatureWays label={collectiveSiteWords.pad} name={who.name} onChange={setGiven} />
            {who.name === '' ? null : <p className="text-[16px] font-semibold">{who.name}</p>}
          </div>
        ) : (
          <SiteText muted>{collectiveSiteWords.notYet}</SiteText>
        )}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={collectiveSiteWords.signNote(duties)}>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Signature}
          disabled={!canSign}
          onClick={() => {
            void sign()
          }}
        >
          {collectiveSiteWords.sign}
        </Button>
      </SiteActionBar>
    </>
  )
}
