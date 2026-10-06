import {
  countingLabel,
  dutyBasisLabel,
  type DutyColleague,
  type DutyDetails,
  type DutyEvidenceEntry,
  dutyInterval,
  dutyMaximum,
  dutyPerformerLabel,
  dutyTaskLabel,
  type EvidenceResult,
  evidenceOriginLabel,
  evidenceResultLabel,
  type EvidenceStanding,
  evidenceStandingLabel,
  intervalWords,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Panel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
} from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  type Fact,
  FactList,
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { titleOfRoom } from '../../app/place-records.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt } from '../../sync/made-at.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import { dutyRegisterPlace } from '../duty-addresses.js'
import {
  DutyStandingMark,
  intervalKindWords,
  kindOfDuty,
  Nobody,
  performerWords,
} from '../duty-words.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'

/** A duty as the server reads it today. */
export function dutyQuery(id: string) {
  return {
    queryKey: ['duties', 'page', id],
    queryFn: () => request<DutyDetails>(`/duties/${id}`),
  } as const
}

/** The evidence of a duty, the newest first. */
export function dutyEvidenceQuery(id: string) {
  return {
    queryKey: ['duties', 'evidence', id],
    queryFn: () => request<DutyEvidenceEntry[]>(`/duties/${id}/evidence`),
  } as const
}

/** The people who can be named for a duty, for whoever keeps the register. */
export const dutyColleaguesQuery = {
  queryKey: ['duties', 'colleagues'],
  queryFn: () => request<DutyColleague[]>('/duties/colleagues'),
} as const

export const dutyPageWords = {
  notThere:
    'Diese Pflicht gibt es nicht mehr, oder sie liegt in einem Bereich, den dieser Zugang nicht sieht.',
  noConnection: 'Die Seite einer Pflicht kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Pflicht wird geladen.',
  failed: 'Die Pflicht ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  neverRecorded: 'keiner, es gibt noch keinen Nachweis',
  resting: 'keiner, solange die Pflicht ruht',
  restingNote:
    'Die Anlage ist nicht in Betrieb. Die Pflicht ruht, bis sie wieder in Betrieb geht, und verfällt nicht.',
  ended: 'keiner, die Pflicht ist beendet',
  noEvidence: 'Für diese Pflicht ist noch kein Nachweis festgehalten.',
  evidenceLoading: 'Die Nachweise werden geladen.',
  whatCounts:
    'Der Termin zählt vom letzten Nachweis, der die Pflicht erfüllt und weder ersetzt noch für ungültig erklärt ist.',
  whoCanBeNamed:
    'Zur Wahl steht, wer für diesen Betreiber arbeitet und nicht gesperrt ist. „Niemand“ nimmt die Person von der Pflicht.',
  untilDelegation:
    'Die Pflichtenübertragung mit Unterschrift kommt mit Phase 2. Bis dahin ist verantwortlich, wen die Pflicht nennt; nennt sie niemanden, erinnert ihre Frist die Leitung.',
  nobody: 'Niemand',
} as const

/**
 * The page of a duty in the office, `pflicht()` of the boards (4.3 and 2.3 of
 * the concept): its next appointment and its evidence, where it comes from,
 * from the catalogue with the version that was confirmed or with its own
 * source, its interval with the reason, who answers for it and who performs
 * it, and what it hangs on.
 *
 * Read from the server, like the register: the state of a duty follows from
 * its evidence, which never travels to a device. The names of the places
 * come from the device. Its evidence is read with the right of the evidence.
 *
 * Whoever keeps the register says who answers for the duty; nobody else is
 * offered the button. What a duty is changed with beyond that arrives with
 * what makes one: confirming a proposal (#102), a duty of the operator's own
 * and ending it (#103), and the page of an evidence (#109).
 */
export function DutyScreen() {
  const { dutyId } = useParams({ strict: false }) as { dutyId?: string }
  const keeps = useRight('duty.write')
  const seesEvidence = useRight('evidence.read')
  const [naming, setNaming] = useState(false)
  const page = useQuery({ ...dutyQuery(dutyId ?? ''), enabled: dutyId !== undefined })
  const evidence = useQuery({
    ...dutyEvidenceQuery(dutyId ?? ''),
    enabled: dutyId !== undefined && seesEvidence,
  })
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const duty = page.data

  if (duty === undefined || dutyId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead title={gone ? 'Nicht gefunden' : 'Pflicht'} crumbs={[dutyRegisterPlace]} />
        <Empty>
          {gone
            ? dutyPageWords.notThere
            : page.isError
              ? dutyPageWords.failed
              : page.fetchStatus === 'paused'
                ? dutyPageWords.noConnection
                : dutyPageWords.loading}
        </Empty>
      </Screen>
    )
  }

  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const property = byId(properties, duty.propertyId)
  const room = byId(rooms, duty.asset?.roomId ?? duty.roomId)
  const building = byId(
    buildings,
    duty.asset?.buildingId ?? duty.buildingId ?? (room ? String(room['buildingId']) : null),
  )
  const kind = kindOfDuty(duty, catalogue)
  const itsPackage =
    duty.kind === null
      ? undefined
      : catalogue?.packages.find(
          (entry) => entry.name === duty.kind?.slice(0, duty.kind.indexOf('.')),
        )
  const maximum = dutyMaximum(duty)
  const { appointment } = duty

  /** What the duty hangs on, in a line under its name. */
  const target =
    duty.asset !== null
      ? `Pflicht an ${[duty.asset.number, duty.asset.name].filter(Boolean).join(' ')}`
      : duty.roomId !== null
        ? `Pflicht am Raum ${room ? titleOfRoom(room) : ''}`.trim()
        : duty.buildingId !== null
          ? `Pflicht am Gebäude ${maybeText(building, 'name') ?? ''}`.trim()
          : `Pflicht an der Liegenschaft ${maybeText(property, 'name') ?? ''}`.trim()

  const origin: Fact[] =
    duty.kind === null
      ? [
          { label: 'Grundlage', value: duty.basis === null ? null : dutyBasisLabel[duty.basis] },
          { label: 'Quelle', value: duty.sourceNote },
        ]
      : [
          {
            label: 'Pflichtart',
            value: (
              <Link to={cataloguePlaces.dutyKind(duty.kind)} className={factLink}>
                {kind?.definition.label ?? duty.title}
              </Link>
            ),
          },
          {
            label: 'Paket',
            value: `${itsPackage?.title ?? duty.kind.slice(0, duty.kind.indexOf('.'))}, Fassung ${String(duty.kindVersion)} der Pflichtart`,
          },
          ...(kind
            ? [
                { label: 'Fundstelle', value: kind.definition.source },
                { label: 'Tätigkeit', value: dutyTaskLabel[kind.definition.task] },
              ]
            : []),
        ]

  return (
    <Screen>
      <PageHead
        title={duty.title}
        crumbs={[dutyRegisterPlace]}
        phoneBack={dutyRegisterPlace}
        badges={
          <>
            <DutyStandingMark duty={duty} />
            {kind ? <ReviewMarks review={kind.review} /> : null}
          </>
        }
        sub={target}
        actions={<ChangesButton table="duties" id={dutyId} />}
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Termin">
            <div className="flex flex-col gap-2.5">
              <FactList
                keyWidth={130}
                facts={[
                  {
                    label: 'Nächster Termin',
                    value: duty.ended
                      ? dutyPageWords.ended
                      : duty.state === 'dormant'
                        ? dutyPageWords.resting
                        : appointment === null
                          ? dutyPageWords.neverRecorded
                          : date(appointment.dueOn),
                  },
                  // Where the counting allows a margin, the last day doing it is on time.
                  ...(!duty.ended &&
                  duty.state !== 'dormant' &&
                  appointment !== null &&
                  appointment.onTimeUntil !== appointment.dueOn
                    ? [{ label: 'Fristgerecht bis', value: date(appointment.onTimeUntil) }]
                    : []),
                  {
                    label: 'Letzter Nachweis',
                    value:
                      duty.lastMetOn === null ? (
                        <span className="text-ink-faint">noch keiner</span>
                      ) : (
                        date(duty.lastMetOn)
                      ),
                  },
                  { label: 'Gezählt', value: countingLabel[duty.counting] },
                  ...(duty.endsOn === null
                    ? []
                    : [
                        {
                          label: duty.ended ? 'Beendet' : 'Endet',
                          value: [
                            `${duty.ended ? 'seit' : 'am'} ${date(duty.endsOn)}`,
                            duty.endReason,
                          ]
                            .filter(Boolean)
                            .join(', '),
                        },
                      ]),
                ]}
              />
              {duty.state === 'dormant' && !duty.ended ? (
                <NoteBox>{dutyPageWords.restingNote}</NoteBox>
              ) : null}
            </div>
          </Panel>
          {seesEvidence ? <Evidence evidence={evidence.data} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Herkunft">
            <FactList
              keyWidth={96}
              facts={[...origin, { label: 'Bestätigt', value: `am ${date(duty.confirmedAt)}` }]}
            />
          </Panel>
          <Panel title="Frist">
            <FactList
              keyWidth={96}
              facts={[
                { label: 'Frist', value: intervalWords(dutyInterval(duty)) },
                { label: 'Art der Frist', value: intervalKindWords(duty, catalogue) },
                ...(maximum === null
                  ? []
                  : [
                      {
                        label: 'Höchstfrist',
                        value: `${intervalWords(maximum)}, am Tag der Bestätigung`,
                      },
                    ]),
                ...(duty.intervalReason === null
                  ? []
                  : [{ label: 'Begründung', value: duty.intervalReason }]),
              ]}
            />
          </Panel>
          <Panel
            title="Zuständig"
            action={
              keeps && !duty.ended ? (
                <Button
                  size="small"
                  aria-label={
                    duty.responsible
                      ? 'Verantwortliche Person ändern'
                      : 'Verantwortliche Person benennen'
                  }
                  onClick={() => {
                    setNaming(true)
                  }}
                >
                  {duty.responsible ? 'Ändern' : 'Benennen'}
                </Button>
              ) : null
            }
          >
            <FactList
              keyWidth={110}
              facts={[
                { label: 'Verantwortlich', value: duty.responsible?.name ?? <Nobody /> },
                {
                  label: 'Ausgeführt von',
                  // In full here: the list names a contractor by its name alone.
                  value:
                    duty.performer === 'contractor' && duty.performerNote !== null
                      ? `${dutyPerformerLabel.contractor}: ${duty.performerNote}`
                      : performerWords(duty),
                },
              ]}
            />
          </Panel>
          <Panel title="Gilt für">
            <FactList
              keyWidth={96}
              facts={[
                ...(duty.asset
                  ? [
                      {
                        label: 'Anlage',
                        value: (
                          <>
                            <Link to={officePlaces.asset(duty.asset.id)} className={factLink}>
                              {duty.asset.name}
                            </Link>
                            {duty.asset.number === null ? null : `, ${duty.asset.number}`}
                          </>
                        ),
                      },
                    ]
                  : []),
                {
                  label: 'Liegenschaft',
                  value: property ? (
                    <Link to={officePlaces.property(duty.propertyId)} className={factLink}>
                      {maybeText(property, 'name')}
                    </Link>
                  ) : null,
                },
                ...(building
                  ? [
                      {
                        label: 'Gebäude',
                        value: (
                          <Link
                            to={officePlaces.building(String(building['id']))}
                            className={factLink}
                          >
                            {maybeText(building, 'name')}
                          </Link>
                        ),
                      },
                    ]
                  : []),
                ...(room
                  ? [
                      {
                        label: 'Raum',
                        value: (
                          <Link to={officePlaces.room(String(room['id']))} className={factLink}>
                            {titleOfRoom(room)}
                          </Link>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Panel>
        </div>
      </div>
      {naming ? (
        <ResponsibleDialog
          key={duty.id}
          duty={duty}
          sub={target.replace(/^Pflicht (an der |am |an )/, '')}
          onClose={() => {
            setNaming(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

const resultTones: Readonly<Record<EvidenceResult, StatusTone>> = {
  without_defects: 'done',
  with_defects: 'conflict',
  failed: 'conflict',
  not_performed: 'neutral',
}

const standingTones: Readonly<Record<EvidenceStanding, StatusTone>> = {
  counts: 'done',
  does_not_meet: 'neutral',
  replaced: 'neutral',
  voided: 'conflict',
}

/**
 * "Nachweise": every evidence of the duty, the newest first, each with what
 * it means for the appointment. One a correction replaced and one declared
 * invalid stay in the list and say so; what does not count stands back.
 */
function Evidence({ evidence }: { readonly evidence: readonly DutyEvidenceEntry[] | undefined }) {
  const title = 'Nachweise'

  if (evidence === undefined || evidence.length === 0) {
    return (
      <Panel title={title}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {evidence === undefined ? dutyPageWords.evidenceLoading : dutyPageWords.noEvidence}
        </p>
      </Panel>
    )
  }

  const result = (entry: DutyEvidenceEntry) => (
    <Status tone={resultTones[entry.result]}>{evidenceResultLabel[entry.result]}</Status>
  )
  const standing = (entry: DutyEvidenceEntry) => (
    <Status tone={standingTones[entry.standing]}>{evidenceStandingLabel[entry.standing]}</Status>
  )
  const back = (entry: DutyEvidenceEntry) => (entry.standing === 'counts' ? '' : 'text-ink-muted')

  return (
    <TablePanel
      title={title}
      caption="Nachweise dieser Pflicht mit Tag, Ergebnis, Herkunft und Bedeutung für die Frist"
      note={dutyPageWords.whatCounts}
      cards={evidence.map((entry) => ({
        key: entry.id,
        title: entry.number,
        sub: [
          date(entry.performedOn),
          evidenceResultLabel[entry.result],
          evidenceOriginLabel[entry.origin],
        ].join(' · '),
        right: standing(entry),
      }))}
    >
      <thead>
        <tr>
          {/* Beside a column of 320 pixels the table has 692 at a width of
              1280: what the columns ask for at least stays below that. */}
          <Column className="w-[124px] min-w-[108px]">Nummer</Column>
          <Column className="w-[92px] min-w-[84px]">Tag</Column>
          <Column className="w-[150px] min-w-[128px]">Ergebnis</Column>
          <Column className="min-w-[110px]">Herkunft</Column>
          <Column className="w-[172px] min-w-[156px]">Für die Frist</Column>
        </tr>
      </thead>
      <tbody>
        {evidence.map((entry) => (
          <tr key={entry.id}>
            <Cell className={back(entry)}>
              <span className="numeric">{entry.number}</span>
            </Cell>
            <Cell className={back(entry)}>{date(entry.performedOn)}</Cell>
            <Cell>{result(entry)}</Cell>
            <Cell className={back(entry)}>{evidenceOriginLabel[entry.origin]}</Cell>
            <Cell>{standing(entry)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * Who answers for a duty, `pflicht_verantwortlich()` of the boards: one of
 * the people who work for the operator and are not shut out, or nobody. In
 * phase 1 the office names the person; the delegation of duties with its
 * signatures comes with phase 2 (4.3 of the concept).
 *
 * Asked of the route of the duty, with a connection, and the page and the
 * register are read again afterwards: both come from the server.
 */
export function ResponsibleDialog({
  duty,
  sub,
  onClose,
}: {
  readonly duty: DutyDetails
  readonly sub: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const colleagues = useQuery(dutyColleaguesQuery)
  const before = duty.responsibleUserId ?? ''
  const [chosen, setChosen] = useState(before)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  // Whoever is shut out is offered to nobody anew. The one the duty names
  // stays in the list all the same, so that the choice shows who it is.
  const offered = (colleagues.data ?? []).filter(
    (person) => person.active || person.userId === before,
  )
  const options = [
    { value: '', label: dutyPageWords.nobody },
    ...offered.map((person) => ({
      value: person.userId,
      label: person.active ? person.name : `${person.name} (gesperrt)`,
    })),
    // Until the people have come, the one the duty names is all there is to show.
    ...(duty.responsible && !offered.some((person) => person.userId === before)
      ? [{ value: duty.responsible.userId, label: duty.responsible.name }]
      : []),
  ]

  async function save() {
    // Nothing changed is nothing to ask the server for.
    if (chosen === before) {
      onClose()

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const result = await askAt(client, 'PATCH', `/duties/${duty.id}`, duty.id, {
        responsibleUserId: chosen === '' ? null : chosen,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['duties'] })
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Verantwortliche Person"
      width={520}
      onClose={onClose}
      sub={[duty.title, sub].filter(Boolean).join(', ')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <SelectField
          label="Verantwortlich"
          options={options}
          value={chosen}
          hint={dutyPageWords.whoCanBeNamed}
          onChange={setChosen}
        />
        <NoteBox>{dutyPageWords.untilDelegation}</NoteBox>
        {colleagues.isError ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            Wer zur Wahl steht, ließ sich nicht laden. Das braucht eine Verbindung.
          </p>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
