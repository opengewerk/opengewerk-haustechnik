import {
  activityKindLabel,
  activityKindOfTask,
  activityStatusLabel,
  countingLabel,
  documentDateWords,
  type DueActivityKind,
  dutyBasisLabel,
  type DutyColleague,
  type DutyDetails,
  type DutyEvidenceEntry,
  dutyInterval,
  dutyMaximum,
  dutyPerformerLabel,
  dutyProblems,
  dutyTaskLabel,
  evidenceOriginLabel,
  evidenceResultLabel,
  intervalWords,
  type RecordState,
  takesAReport,
  takesAWorkOrder,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
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
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { useState } from 'react'

import { ContractorName } from '../contractor-field.js'
import { titleOfRoom } from '../../app/place-records.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { activityPlaces } from '../activity-addresses.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import { documentPlaces } from '../document-addresses.js'
import { dutyPlaces, dutyRegisterPlace, evidencePlaces } from '../duty-addresses.js'
import {
  DutyStandingMark,
  ContractEndedStatus,
  IntervalCheckStatus,
  intervalKindWords,
  kindOfDuty,
  Nobody,
  performerWords,
} from '../duty-words.js'
import { contractPlaces } from '../contract-addresses.js'
import { delegationPlaces } from '../delegation-addresses.js'
import { EvidenceNumber, ResultMark, StandingMark } from '../evidence-words.js'
import { LinkButton } from '../link-button.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { workOrderPlaces, workOrderStartSearch } from '../work-order-addresses.js'
import { shorterNote, UpdateMark, UpdatePanel, UpdateStatus } from './duty-updates.js'

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

/**
 * The document that bears the interval of a duty, as the card "Frist" names
 * it (#74): a link to it and the version the duty points at, by the day it was
 * filed, with the day it is valid until or to be reviewed (#327). One taken
 * out of the records is named and leads nowhere.
 */
function IntervalDocument({ duty }: { readonly duty: DutyDetails }) {
  const document = duty.intervalDocument

  if (document === null) {
    return null
  }

  return (
    <div className="leading-[1.32]">
      {document.removed ? (
        <span>{document.title}</span>
      ) : (
        <Link to={documentPlaces.document(document.id)} className={factLink}>
          {document.title}
        </Link>
      )}
      <div className="text-[12px] text-ink-faint">
        {document.removed
          ? dutyPageWords.documentRemoved
          : [
              `Fassung ${String(document.version.number)} vom ${date(document.version.filedOn)}`,
              // Its validity, the review of a risk assessment above all (#327).
              document.version.validUntil === null
                ? null
                : documentDateWords(document.kind, date(document.version.validUntil)),
            ]
              .filter(Boolean)
              .join(', ')}
      </div>
    </div>
  )
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
  // Who answers for a duty since the delegations (#336).
  delegationRule:
    'Deckt eine Pflichtenübertragung die Pflicht, ist ihre beauftragte Person verantwortlich. Hier benennen Sie nur, wen keine Übertragung deckt; die Person trägt dann den Hinweis „ohne Übertragung“.',
  fromDelegation: (lastDay: string) => `aus der Pflichtenübertragung, bis ${date(lastDay)}`,
  withoutDelegation: 'ohne Übertragung',
  severalCover: (count: number) =>
    `${count === 2 ? 'zwei' : 'mehrere'} Pflichtenübertragungen decken die Pflicht`,
  chooseAmong: (names: readonly string[]) =>
    names.length === 2
      ? `Die Übertragungen an ${names.join(' und an ')} decken beide diese Pflicht. Wählen Sie, wer verantwortlich ist.`
      : `Die Übertragungen an ${names.slice(0, -1).join(', ')} und ${names.at(-1) ?? ''} decken alle diese Pflicht. Wählen Sie, wer verantwortlich ist.`,
  nobody: 'Niemand',
  whatEnds:
    'Vom Tag des Endes an ruft die Pflicht nach nichts mehr: sie hat keinen Termin und erinnert niemanden. Ihre Nachweise bleiben, und im Verzeichnis steht sie unter „Beendet“.',
  endsForGood:
    'Ein Ende wird nicht zurückgenommen. Wird die Pflicht doch wieder gebraucht, wird sie neu angelegt.',
  noEndDay: 'Der Tag fehlt, an dem die Pflicht endet.',
  endReasonHint: 'Auf Wunsch, etwa: Anlage zurückgebaut.',
  noActivity: 'keiner offen',
  whatMakingDoes:
    'entsteht, wie sie aus dem Termin entstanden wäre, mit dem Formular der Pflichtart. Wer ausführt und an welchem Tag, wird danach auf ihrer Seite geplant. Der Termin der Pflicht ändert sich dadurch nicht.',
  removeAsks:
    'Die Pflicht verschwindet aus dem Pflichtenverzeichnis und von ihrer Anlage und erinnert niemanden mehr. Was zu ihr geplant und nicht unterschrieben ist, geht mit. Der Katalog schlägt ihre Pflichtart für die Anlage danach wieder vor; gilt sie dort nicht, verwerfen Sie den Vorschlag. Im Änderungsprotokoll bleibt stehen, wer sie bestätigt und wer sie entfernt hat. War sie kein Irrtum und gilt nur nicht mehr, beenden Sie sie stattdessen.',
  documentRemoved: 'aus der Ablage entfernt',
  checkWithChange: 'Mit „Ändern“ und „Speichern“ zeigt die Pflicht auf die neue Fassung.',
  removedCheck:
    'Das Dokument, das die Frist trägt, ist aus der Ablage entfernt. Prüfen Sie, ob die Frist noch stimmt.',
  removedWithChange: 'Unter „Ändern“ wählen Sie ein anderes Dokument oder keines.',
} as const

/**
 * The note in the card "Frist" of a duty that says "Frist prüfen" (#74): a
 * newer version of the document lies over the one the duty points at, since
 * the day it was filed, or the document was taken out of the records. What to
 * do about it is said to whoever can.
 */
function intervalCheckNote(document: NonNullable<DutyDetails['intervalDocument']>, can: boolean) {
  if (document.removed) {
    return [dutyPageWords.removedCheck, can ? dutyPageWords.removedWithChange : null]
      .filter(Boolean)
      .join(' ')
  }

  return [
    document.newer === null
      ? null
      : `Seit dem ${date(document.newer.filedOn)} liegt Fassung ${String(document.newer.number)} des Dokuments vor. Prüfen Sie, ob die Frist noch stimmt.`,
    can ? dutyPageWords.checkWithChange : null,
  ]
    .filter(Boolean)
    .join(' ')
}

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
 * Whoever keeps the register says who answers for the duty and ends it,
 * changes a duty of the operator's own in its form (#178) and sets the
 * interval of a duty from the catalogue in the form that confirmed it
 * (#102); nobody else is offered the buttons. A duty from the catalogue that
 * was confirmed by mistake is removed here, while it has left no record
 * (#241): it has no form, where one of the operator's own is removed.
 */
export function DutyScreen() {
  const { dutyId } = useParams({ strict: false }) as { dutyId?: string }
  const keeps = useRight('duty.write')
  const seesEvidence = useRight('evidence.read')
  const entersEvidence = useRight('evidence.write')
  const readsActivities = useRight('activity.read')
  const plans = useRight('activity.write')
  const navigate = useNavigate()
  const [naming, setNaming] = useState(false)
  const [ending, setEnding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [making, setMaking] = useState(false)
  const page = useQuery({ ...dutyQuery(dutyId ?? ''), enabled: dutyId !== undefined })
  const evidence = useQuery({
    ...dutyEvidenceQuery(dutyId ?? ''),
    enabled: dutyId !== undefined && seesEvidence,
  })
  const catalogue = useCatalogue()
  const duty = page.data
  const { property, building, room } = useDutyPlaces(duty)

  if (duty === undefined || dutyId === undefined) {
    return <DutyUnread page={page} />
  }

  const kind = kindOfDuty(duty, catalogue)
  const itsPackage =
    duty.kind === null
      ? undefined
      : catalogue?.packages.find(
          (entry) => entry.name === duty.kind?.slice(0, duty.kind.indexOf('.')),
        )
  const maximum = dutyMaximum(duty)
  const { appointment, activity } = duty
  // What a new activity of this duty is, by its task (#183), and whether one
  // is offered: for whoever plans, while the duty stands, does not rest and
  // has none under way, and once the task is known, which for a duty from the
  // catalogue its kind says.
  const comesOf = activityKindOfTask(duty.task ?? kind?.definition.task ?? null)
  const makes =
    plans &&
    !duty.ended &&
    duty.state !== 'dormant' &&
    activity === null &&
    (duty.kind === null || kind !== null)

  const target = dutyTarget(duty, { property, building, room })

  const origin: Fact[] =
    duty.kind === null
      ? [
          { label: 'Grundlage', value: duty.basis === null ? null : dutyBasisLabel[duty.basis] },
          { label: 'Quelle', value: duty.sourceNote },
          // A duty entered before it had to name its task names none.
          ...(duty.task === null ? [] : [{ label: 'Tätigkeit', value: dutyTaskLabel[duty.task] }]),
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
            {duty.intervalToCheck ? <IntervalCheckStatus /> : null}
            {duty.contractEnded ? <ContractEndedStatus /> : null}
            {duty.update ? <UpdateStatus /> : null}
            {kind ? <ReviewMarks review={kind.review} /> : null}
          </>
        }
        sub={target}
        actions={
          <>
            <ChangesButton table="duties" id={dutyId} />
            {/* What a duty from the catalogue is comes from its kind (#178). */}
            {keeps && duty.kind === null && !duty.ended ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: dutyPlaces.edit(dutyId) })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
            {entersEvidence && !duty.ended && takesAReport(duty, kind) ? (
              <Button
                icon={Upload}
                onClick={() => {
                  void navigate({ to: evidencePlaces.report(dutyId) })
                }}
              >
                Bericht eintragen
              </Button>
            ) : null}
            {keeps && duty.endsOn === null ? (
              <Button
                onClick={() => {
                  setEnding(true)
                }}
              >
                Beenden
              </Button>
            ) : null}
            {/* Confirmed by mistake: no evidence and no activity that was signed
                or closed, which the server says as the route asks it (#241). */}
            {keeps && duty.kind !== null && !duty.ended && duty.removable ? (
              <Button
                tone="danger"
                icon={Trash2}
                onClick={() => {
                  setRemoving(true)
                }}
              >
                Entfernen
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel
            title="Termin"
            action={
              makes ? (
                <div className="flex flex-wrap gap-1.5">
                  {/* Or a work order for the due day, for a duty that takes one (#117). */}
                  {takesAWorkOrder(duty, kind) ? (
                    <Button
                      size="small"
                      icon={Plus}
                      onClick={() => {
                        void navigate({
                          to: workOrderPlaces.new,
                          search: workOrderStartSearch({ dutyId }),
                        })
                      }}
                    >
                      Auftrag anlegen
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    icon={Plus}
                    onClick={() => {
                      setMaking(true)
                    }}
                  >
                    {activityKindLabel[comesOf]} anlegen
                  </Button>
                </div>
              ) : undefined
            }
          >
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
                  // The activity under way, for whoever reads activities (#183).
                  ...(readsActivities
                    ? [
                        {
                          label: 'Vorgang',
                          value:
                            activity === null ? (
                              <span className="text-ink-faint">{dutyPageWords.noActivity}</span>
                            ) : (
                              <Link to={activityPlaces.activity(activity.id)} className={factLink}>
                                {[
                                  activityKindLabel[activity.kind],
                                  activityStatusLabel[activity.status].toLowerCase(),
                                  activity.dueOn === null
                                    ? null
                                    : `fällig am ${date(activity.dueOn)}`,
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </Link>
                            ),
                        },
                      ]
                    : []),
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
          {/* What the catalogue says differently, until somebody decides (#139). */}
          {duty.update ? <UpdatePanel update={duty.update} /> : null}
          <Panel title="Herkunft">
            <FactList
              keyWidth={96}
              facts={[...origin, { label: 'Bestätigt', value: `am ${date(duty.confirmedAt)}` }]}
            />
          </Panel>
          <Panel
            title="Frist"
            action={
              // The interval of a duty from the catalogue, its reason and who
              // performs it (#102); a duty of the operator's own changes it in
              // its form.
              keeps && !duty.ended && duty.kind !== null ? (
                <LinkButton to={dutyPlaces.interval(dutyId)} size="small" label="Frist ändern">
                  Ändern
                </LinkButton>
              ) : null
            }
          >
            <div className="flex flex-col gap-2.5">
              <FactList
                keyWidth={96}
                facts={[
                  {
                    label: 'Frist',
                    // The interval it was confirmed with, and below it what a
                    // regulation cut it short to (#139).
                    value: duty.shortened ? (
                      <span className="flex flex-col gap-[3px]">
                        <span>{intervalWords(dutyInterval(duty))}</span>
                        <UpdateMark shortened counts={duty.shortened} />
                      </span>
                    ) : (
                      intervalWords(dutyInterval(duty))
                    ),
                  },
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
                  // The document that bears the interval, with the version the
                  // duty points at (#74).
                  ...(duty.intervalDocument === null
                    ? []
                    : [{ label: 'Dokument', value: <IntervalDocument duty={duty} /> }]),
                ]}
              />
              {duty.intervalToCheck && duty.intervalDocument !== null ? (
                <NoteBox tone="waiting" icon={TriangleAlert}>
                  {intervalCheckNote(
                    duty.intervalDocument,
                    keeps && !duty.ended && duty.kind !== null,
                  )}
                </NoteBox>
              ) : null}
              {duty.update?.shorter ? (
                <NoteBox tone="waiting">
                  {shorterNote(duty.update.shorter, dutyInterval(duty), today())}
                </NoteBox>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Zuständig"
            action={
              // One delegation that covers it names the person, and only it changes that (#336).
              keeps && !duty.ended && duty.covering.length !== 1 ? (
                <Button
                  size="small"
                  aria-label={
                    duty.covering.length > 1
                      ? 'Verantwortliche Person wählen'
                      : duty.responsible
                        ? 'Verantwortliche Person ändern'
                        : 'Verantwortliche Person benennen'
                  }
                  onClick={() => {
                    setNaming(true)
                  }}
                >
                  {duty.covering.length > 1 ? 'Wählen' : duty.responsible ? 'Ändern' : 'Benennen'}
                </Button>
              ) : null
            }
          >
            <FactList
              keyWidth={110}
              facts={[
                { label: 'Verantwortlich', value: <Responsible duty={duty} /> },
                {
                  label: 'Ausgeführt von',
                  // In full here: the list names a contractor by its name alone.
                  // The firm out of the list leads to its page (#328); a name as text stays text.
                  value:
                    duty.performer === 'contractor' && duty.contractorId ? (
                      <>
                        {`${dutyPerformerLabel.contractor}: `}
                        <ContractorName
                          contractorId={duty.contractorId}
                          note={duty.performerNote}
                        />
                      </>
                    ) : duty.performer === 'contractor' && duty.performerNote !== null ? (
                      `${dutyPerformerLabel.contractor}: ${duty.performerNote}`
                    ) : (
                      performerWords(duty)
                    ),
                },
                // The contract it fulfils (#329), for whoever reads the contracts,
                // and the day it ended where it has.
                ...(duty.contract === null
                  ? []
                  : [
                      {
                        label: 'Vertrag',
                        value: (
                          <div className="leading-[1.32]">
                            <Link to={contractPlaces.contract(duty.contract.id)}>
                              {duty.contract.title}
                            </Link>
                            {duty.contract.endedOn === null ? null : (
                              <div className="text-[12px] text-conflict">
                                {`abgelaufen am ${date(duty.contract.endedOn)}`}
                              </div>
                            )}
                          </div>
                        ),
                      },
                    ]),
              ]}
            />
            {/* Several delegations cover it, and none of their persons is chosen yet (#336). */}
            {duty.covering.length > 1 && duty.delegation === null && !duty.ended ? (
              <div className="mt-3">
                <NoteBox tone="waiting" icon={TriangleAlert}>
                  {dutyPageWords.chooseAmong(duty.covering.map((each) => each.delegateName))}
                </NoteBox>
              </div>
            ) : null}
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
      {making ? (
        <NewActivityDialog
          key={duty.id}
          duty={duty}
          kind={comesOf}
          sub={target.replace(/^Pflicht (an der |am |an )/, '')}
          onClose={() => {
            setMaking(false)
          }}
        />
      ) : null}
      {ending ? (
        <EndDutyDialog
          key={duty.id}
          duty={duty}
          sub={target.replace(/^Pflicht (an der |am |an )/, '')}
          onClose={() => {
            setEnding(false)
          }}
        />
      ) : null}
      {removing ? (
        <RemoveDutyConfirm
          key={duty.id}
          duty={duty}
          onClose={() => {
            setRemoving(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** The property, the building and the room of a duty, as this device holds them. */
interface DutyPlaceRecords {
  readonly property: RecordState | null
  readonly building: RecordState | null
  readonly room: RecordState | null
}

/** The places of a duty, read from the device: where its asset stands, or what it hangs on. */
export function useDutyPlaces(duty: DutyDetails | undefined): DutyPlaceRecords {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  if (duty === undefined) {
    return { property: null, building: null, room: null }
  }

  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const room = byId(rooms, duty.asset?.roomId ?? duty.roomId)

  return {
    property: byId(properties, duty.propertyId),
    building: byId(
      buildings,
      duty.asset?.buildingId ?? duty.buildingId ?? (room ? String(room['buildingId']) : null),
    ),
    room,
  }
}

/** What a duty hangs on, in a line under its name: "Pflicht an AN-00057 Trinkwassererwärmer". */
export function dutyTarget(duty: DutyDetails, { property, building, room }: DutyPlaceRecords) {
  return duty.asset !== null
    ? `Pflicht an ${[duty.asset.number, duty.asset.name].filter(Boolean).join(' ')}`
    : duty.roomId !== null
      ? `Pflicht am Raum ${room ? titleOfRoom(room) : ''}`.trim()
      : duty.buildingId !== null
        ? `Pflicht am Gebäude ${maybeText(building, 'name') ?? ''}`.trim()
        : `Pflicht an der Liegenschaft ${maybeText(property, 'name') ?? ''}`.trim()
}

/** In place of a duty that has not come from the server, with why. */
export function DutyUnread({ page }: { readonly page: UseQueryResult<DutyDetails> }) {
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

/**
 * Who may be named for a duty: "Niemand", and whoever works for the
 * operator. Whoever is shut out is offered to nobody anew; the one the duty
 * names stays in the list all the same, so that the choice shows who it is,
 * and until the people have come, that one is all there is to show.
 */
export function responsibleChoices(
  colleagues: readonly DutyColleague[] | undefined,
  named: DutyDetails['responsible'],
) {
  const offered = (colleagues ?? []).filter(
    (person) => person.active || person.userId === named?.userId,
  )

  return [
    { value: '', label: dutyPageWords.nobody },
    ...offered.map((person) => ({
      value: person.userId,
      label: person.active ? person.name : `${person.name} (gesperrt)`,
    })),
    ...(named && !offered.some((person) => person.userId === named.userId)
      ? [{ value: named.userId, label: named.name }]
      : []),
  ]
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

  const result = (entry: DutyEvidenceEntry) => <ResultMark result={entry.result} />
  const standing = (entry: DutyEvidenceEntry) => (
    <StandingMark standing={entry.standing} emptied={entry.emptied === true} />
  )
  const back = (entry: DutyEvidenceEntry) => (entry.standing === 'counts' ? '' : 'text-ink-muted')

  return (
    <TablePanel
      title={title}
      caption="Nachweise dieser Pflicht mit Tag, Ergebnis, Herkunft und Bedeutung für die Frist"
      note={dutyPageWords.whatCounts}
      cards={evidence.map((entry) => ({
        key: entry.id,
        title: <EvidenceNumber id={entry.id} number={entry.number} />,
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
              <EvidenceNumber id={entry.id} number={entry.number} />
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
  // Where several delegations cover the duty, the choice is one of their persons (#336).
  const several = duty.covering.length > 1
  const options = several
    ? [
        ...(duty.covering.some((each) => each.delegateUserId === before)
          ? []
          : [{ value: before, label: duty.responsible?.name ?? dutyPageWords.nobody }]),
        ...duty.covering.map((each) => ({ value: each.delegateUserId, label: each.delegateName })),
      ]
    : responsibleChoices(colleagues.data, duty.responsible)

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
          {...(several ? {} : { hint: dutyPageWords.whoCanBeNamed })}
          onChange={setChosen}
        />
        <NoteBox>
          {several
            ? dutyPageWords.chooseAmong(duty.covering.map((each) => each.delegateName))
            : dutyPageWords.delegationRule}
        </NoteBox>
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

/**
 * The day a duty ends, `pflicht_beenden()` of the boards (4.3 of the
 * concept): today unless another day is named, with a reason on request.
 * From that day on the duty has no appointment and reminds nobody; its
 * evidence stays, and the register lists it among the ended ones.
 *
 * Asked of the route of the duty, with a connection. An end is not taken
 * back, and the dialog says so before it is set.
 */
export function EndDutyDialog({
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
  const [endsOn, setEndsOn] = useState<string>(() => today())
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save() {
    const values = {
      endsOn: endsOn === '' ? null : endsOn,
      endReason: reason.trim() === '' ? null : reason.trim(),
    }
    const wrong = {
      ...dutyProblems(values),
      ...(values.endsOn === null ? { endsOn: dutyPageWords.noEndDay } : {}),
    }

    setProblems(wrong)
    setTrouble(null)

    if (Object.keys(wrong).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/duties/${duty.id}/end`, duty.id, values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The page and the register are read again, and what was read of the
      // assets is dropped: the file of the asset lists the duties that stand.
      await queries.invalidateQueries({ queryKey: ['duties'] })
      queries.removeQueries({ queryKey: ['assets'] })
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Pflicht beenden"
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
        <Field
          label="Endet am"
          type="date"
          required
          starred
          value={endsOn}
          problem={problems['endsOn']}
          onChange={(event) => {
            setEndsOn(event.target.value)
          }}
        />
        <Field
          label="Grund"
          value={reason}
          hint={dutyPageWords.endReasonHint}
          problem={problems['endReason']}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox>
          {dutyPageWords.whatEnds} {dutyPageWords.endsForGood}
        </NoteBox>
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
            {working ? 'Einen Moment' : 'Pflicht beenden'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * The question before a duty from the catalogue that was confirmed by mistake
 * is removed, `pflicht_katalog_entfernen()` of the boards (#241, 4.3 of the
 * concept): what removing means, that the catalogue proposes its kind for the
 * asset again, and when to end the duty instead.
 *
 * Asked of the route of the duty, with a connection. What the server refuses
 * with stands in the question, which stays open. Once the duty is gone, the
 * file of its asset opens, where its proposal stands again.
 */
function RemoveDutyConfirm({
  duty,
  onClose,
}: {
  readonly duty: DutyDetails
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function remove() {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await askAt(client, 'DELETE', `/duties/${duty.id}`, duty.id)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // Nothing read of the duties and of the assets holds any more: the
      // register and the file of the asset list the duty, and the proposals
      // of the asset leave its kind out.
      queries.removeQueries({ queryKey: ['duties'] })
      queries.removeQueries({ queryKey: ['assets'] })
      await navigate({
        to: duty.asset === null ? dutyRegisterPlace.to : officePlaces.asset(duty.asset.id),
      })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Confirm
      open
      title={`„${duty.title}“ entfernen?`}
      confirm="Entfernen"
      tone="danger"
      busy={working}
      onConfirm={() => {
        void remove()
      }}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-2">
        <p>{dutyPageWords.removeAsks}</p>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Confirm>
  )
}

/**
 * An inspection or a maintenance made by hand, `vorgang_anlegen()` of the
 * boards (#183, 4.4 of the concept): for a duty with none under way, said
 * before it is made. It is due on the next appointment, today for a duty
 * never recorded, performed as the duty says and answered for by the person
 * the duty names; its page plans the rest, and opens once it is made.
 */
function NewActivityDialog({
  duty,
  kind,
  sub,
  onClose,
}: {
  readonly duty: DutyDetails
  readonly kind: DueActivityKind
  readonly sub: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const label = activityKindLabel[kind]
  const dueOn = duty.appointment?.dueOn ?? today()

  async function make() {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await makeAt(client, '/activities', { dutyId: duty.id })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['duties'] })
      await queries.invalidateQueries({ queryKey: ['activities'] })
      void navigate({ to: activityPlaces.activity(result.id) })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title={`${label} anlegen`}
      width={520}
      onClose={onClose}
      sub={[duty.title, sub].filter(Boolean).join(', ')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void make()
        }}
      >
        <Panel>
          <FactList
            keyWidth={120}
            facts={[
              { label: 'Art', value: label },
              {
                label: 'Fällig am',
                value:
                  duty.state === 'overdue' ? (
                    <span className="font-semibold text-conflict">{date(dueOn)}, überfällig</span>
                  ) : (
                    date(dueOn)
                  ),
              },
              {
                label: 'Durchführung',
                value:
                  duty.performer === null ? null : duty.performer === 'contractor' ? (
                    !duty.contractorId ? (
                      ['Fremde Durchführung', duty.performerNote].filter(Boolean).join(', ')
                    ) : (
                      <>
                        {'Fremde Durchführung, '}
                        <ContractorName
                          contractorId={duty.contractorId}
                          note={duty.performerNote}
                        />
                      </>
                    )
                  ) : (
                    'Eigene Durchführung'
                  ),
              },
              { label: 'Verantwortlich', value: duty.responsible?.name ?? <Nobody /> },
            ]}
          />
        </Panel>
        <NoteBox>
          Die {label} {dutyPageWords.whatMakingDoes}
        </NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Plus} disabled={working}>
            {working ? 'Einen Moment' : `${label} anlegen`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * Who answers for a duty, and where that comes from (#336): a delegation,
 * with its last day and, for whoever may delegate, the way to it; or none,
 * "ohne Übertragung"; or nobody, with a word where several delegations cover
 * the duty and the office has yet to choose.
 */
function Responsible({ duty }: { readonly duty: DutyDetails }) {
  const delegates = useRight('duty.delegate')

  if (duty.responsible === null) {
    return (
      <div className="leading-[1.35]">
        <Nobody />
        {duty.covering.length > 1 ? (
          <div className="text-[12px] text-ink-faint">
            {dutyPageWords.severalCover(duty.covering.length)}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="leading-[1.35]">
      <div>{duty.responsible.name}</div>
      {duty.delegation === null ? (
        // A duty that ended is covered by no delegation, and calls for none.
        duty.ended ? null : (
          <div className="text-[12px] text-waiting">{dutyPageWords.withoutDelegation}</div>
        )
      ) : delegates ? (
        <Link
          to={delegationPlaces.delegation(duty.delegation.id)}
          className="text-[12px] text-ink-faint"
        >
          {dutyPageWords.fromDelegation(duty.delegation.lastDay)}
        </Link>
      ) : (
        <div className="text-[12px] text-ink-faint">
          {dutyPageWords.fromDelegation(duty.delegation.lastDay)}
        </div>
      )}
    </div>
  )
}
