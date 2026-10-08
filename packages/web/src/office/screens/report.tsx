import {
  countingLabel,
  defectClassChoices,
  type DutyDetails,
  type DutyPerformer,
  dutyInterval,
  type EvidenceResult,
  evidenceLimits,
  evidenceResultLabel,
  meetsTheDuty,
  nextAppointment,
  type RecordState,
  reportDefectField,
  reportProblems,
  resultsWithDefects,
  takesAReport,
  untitledDocument,
} from '@opengewerk/haustechnik-domain'
import { Button, Choice, Field, Panel, SelectField } from '@opengewerk/platform-web'
import { prepareVersion } from '@opengewerk/platform-web/attachments'
import { date, fileSize, today } from '@opengewerk/platform-web/format'
import { Empty, FactList, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { FileText, Lock, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { placeAbove, titleOfRoom } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { makeAt } from '../../sync/made-at.js'
import { dutyPlaces, dutyRegisterPlace, evidencePlaces, reportActivity } from '../duty-addresses.js'
import { dutySourceWords, kindOfDuty } from '../duty-words.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { dutyEvidenceQuery, dutyQuery } from './duty.js'

export const reportWords = {
  notThere:
    'Diese Pflicht gibt es nicht mehr, oder sie liegt in einem Bereich, den dieser Zugang nicht sieht.',
  noConnection: 'Ein Bericht wird mit Verbindung eingetragen. Gerade ist keine da.',
  loading: 'Die Pflicht wird geladen.',
  failed: 'Die Pflicht ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  notForYou: 'Einen Bericht trägt ein, wer Nachweise eintragen darf.',
  noReport: 'Diese Pflichtart nimmt keinen Bericht als Nachweis.',
  noFile: 'Es ist noch keine Datei gewählt.',
  noDefect: 'Der Bericht nennt noch keinen Mangel.',
  withoutClass: 'Ohne Klasse',
  resultNotes: {
    without_defects: undefined,
    with_defects: 'Die Pflicht ist erfüllt, die Mängel werden geführt.',
    failed: 'Die Pflicht bleibt offen, bis eine Prüfung bestanden ist.',
    not_performed: 'Mit Grund. Am Termin ändert sich nichts.',
  } satisfies Readonly<Record<EvidenceResult, string | undefined>>,
} as const

/** "Ab dem Tag der Durchführung" in the middle of a sentence. */
function lowerFirst(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1)
}

/** A defect as the form holds it, with a key of its own for the row. */
interface DefectRow {
  readonly key: number
  readonly description: string
  readonly defectClass: string
  readonly dueOn: string
}

/**
 * "Bericht einer Fremdfirma eintragen (4.4)", `bericht()` of the boards
 * (#110, section 4.4 of the concept, "fremde Durchführung"): the file of the
 * report or the certificate, the examiner and the organisation, the day of
 * the test, the result and the defects it names. Written down, it is the
 * evidence of the duty with the next number, and the page of the evidence
 * opens.
 *
 * The file goes to the store first, the way every file goes, and the report
 * names it; the server files it as a document at the place of the duty and
 * writes the evidence, the defects and an open inspection of the duty off in
 * one go. So it needs a connection, and it is for whoever enters evidence.
 */
export function ReportScreen() {
  const { dutyId } = useParams({ strict: false }) as { dutyId?: string }
  const fromActivity = reportActivity(useSearch({ strict: false }))
  const enters = useRight('evidence.write')
  const page = useQuery({ ...dutyQuery(dutyId ?? ''), enabled: dutyId !== undefined })
  const catalogue = useCatalogue()
  const duty = page.data

  if (duty === undefined || dutyId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Bericht eintragen'}
          crumbs={[dutyRegisterPlace]}
          phoneBack={dutyRegisterPlace}
        />
        <Empty>
          {gone
            ? reportWords.notThere
            : page.isError
              ? reportWords.failed
              : page.fetchStatus === 'paused'
                ? reportWords.noConnection
                : reportWords.loading}
        </Empty>
      </Screen>
    )
  }

  const kind = kindOfDuty(duty, catalogue)
  const unwelcome = !enters
    ? reportWords.notForYou
    : catalogue !== null && !takesAReport(duty, kind)
      ? reportWords.noReport
      : null

  // Entered from the activity of the duty that is under way, the report comes
  // from whoever is planned at it (#186); from anywhere else, from whoever
  // the duty names.
  const { activity } = duty
  const performedBy =
    activity !== null && activity.id === fromActivity
      ? { performer: activity.performer, note: activity.contractorNote }
      : { performer: duty.performer, note: duty.performerNote }

  return <ReportForm key={duty.id} duty={duty} performedBy={performedBy} unwelcome={unwelcome} />
}

function ReportForm({
  duty,
  performedBy,
  unwelcome,
}: {
  readonly duty: DutyDetails
  /** Who the report is expected from: the own people or a contractor, and which. */
  readonly performedBy: {
    readonly performer: DutyPerformer | null
    readonly note: string | null
  }
  /** Why nothing is entered here, or null where a report may be. */
  readonly unwelcome: string | null
}) {
  const byContractor = performedBy.performer === 'contractor'
  const contractor = byContractor ? performedBy.note : null
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const catalogue = useCatalogue()
  const seesEvidence = useRight('evidence.read')
  const evidence = useQuery({ ...dutyEvidenceQuery(duty.id), enabled: seesEvidence })
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')
  const picker = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [examiner, setExaminer] = useState('')
  const [organisation, setOrganisation] = useState(contractor ?? '')
  const [performedOn, setPerformedOn] = useState('')
  const [result, setResult] = useState<EvidenceResult>('without_defects')
  const [resultReason, setResultReason] = useState('')
  const [defects, setDefects] = useState<readonly DefectRow[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const asset = byId(assets, duty.assetId)
  const room = byId(rooms, duty.asset?.roomId ?? duty.roomId)
  const building = byId(
    buildings,
    duty.asset?.buildingId ?? duty.buildingId ?? (room ? String(room['buildingId']) : null),
  )
  const property = byId(properties, duty.propertyId)
  const dutyCrumb = { to: dutyPlaces.duty(duty.id), label: duty.title }
  const crumbs = property
    ? [
        ...placePath(
          placeAbove({
            property,
            building,
            floor: room ? byId(floors, String(room['floorId'])) : null,
            room,
            asset,
          }),
          officePlaces,
        ),
        dutyCrumb,
      ]
    : [dutyRegisterPlace, dutyCrumb]
  // What the duty hangs on, in a few words: the asset, the room, the building or the property.
  const where =
    duty.asset !== null
      ? [duty.asset.number, duty.asset.name].filter(Boolean).join(' ')
      : room
        ? titleOfRoom(room)
        : (maybeText(building, 'name') ?? maybeText(property, 'name') ?? '')
  const sub = [
    where === '' ? duty.title : `${duty.title} an ${where}`,
    byContractor ? 'durchgeführt von einer Fremdfirma' : null,
  ]
    .filter(Boolean)
    .join(', ')
  const counting = lowerFirst(countingLabel[duty.counting])
  // The classes a defect of this duty may take, as the server holds them
  // (#116): those of the package of its kind, or the general ones.
  const classes = catalogue === null ? [] : defectClassChoices(catalogue, [duty.kind])
  const namesDefects = resultsWithDefects.includes(result)
  const filled = (value: string) => (value.trim() === '' ? null : value.trim())

  /** Where the next due day goes, once the report meets the duty: from what counts, and this day. */
  const counted = evidence.data
    ?.filter((entry) => entry.standing === 'counts')
    .map((entry) => entry.performedOn)
  const next =
    counted !== undefined && performedOn !== '' && meetsTheDuty(result) && !duty.ended
      ? nextAppointment({ counting: duty.counting, interval: dutyInterval(duty) }, [
          ...counted,
          performedOn,
        ])
      : null

  function choose(chosen: File | undefined) {
    if (chosen) {
      setFile(chosen)
      setProblems(({ file: _, ...others }) => others)
    }
  }

  function changeDefect(key: number, change: Partial<DefectRow>) {
    setDefects((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  async function save() {
    const said = {
      performedOn: performedOn === '' ? null : performedOn,
      result,
      resultReason: result === 'not_performed' ? filled(resultReason) : null,
      examiner: filled(examiner),
      examinerOrganisation: filled(organisation),
      defects: namesDefects
        ? defects.map((row) => ({
            description: row.description.trim(),
            defectClass: row.defectClass === '' ? null : row.defectClass,
            dueOn: row.dueOn === '' ? null : row.dueOn,
          }))
        : [],
    }
    const known = new Set(classes.map((each) => each.defectClass.key))
    // The file is asked about by its name and size before its bytes are read.
    const wrong = reportProblems(
      {
        ...said,
        file:
          file === null
            ? null
            : {
                sha256: '0'.repeat(64),
                fileName: file.name,
                sizeBytes: file.size,
                previewSha256: null,
              },
      },
      today(),
      (key) => known.has(key),
    )

    setProblems(wrong)
    setTrouble(null)

    if (Object.keys(wrong).length > 0 || file === null) {
      return
    }

    setWorking(true)

    try {
      // A scan of a certificate stays as it was taken: it is the evidence.
      const prepared = await prepareVersion(client, file, {
        untitled: untitledDocument,
        keepOriginal: true,
      })

      if ('problem' in prepared) {
        setProblems({ file: prepared.problem })

        return
      }

      // The bytes go up ahead of the report, which names them.
      await client.synchronise()

      const made = await makeAt(client, `/duties/${duty.id}/report`, {
        ...said,
        file: {
          sha256: prepared.sha256,
          fileName: prepared.fileName,
          sizeBytes: prepared.sizeBytes,
          previewSha256: prepared.previewSha256,
        },
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      await queries.invalidateQueries({ queryKey: ['evidence'] })
      await queries.invalidateQueries({ queryKey: ['duties'] })
      await queries.invalidateQueries({ queryKey: ['activities'] })
      queries.removeQueries({ queryKey: ['assets'] })
      await navigate({ to: evidencePlaces.evidence(made.id) })
    } finally {
      setWorking(false)
    }
  }

  const side = (
    <Panel title="Pflicht">
      <FactList
        keyWidth={96}
        facts={[
          {
            label: 'Pflicht',
            value: (
              <Link to={dutyPlaces.duty(duty.id)} className={factLink}>
                {duty.title}
              </Link>
            ),
          },
          { label: 'Fundstelle', value: dutySourceWords(duty, catalogue) || null },
          {
            label: 'Termin',
            value:
              duty.appointment === null ? (
                'keiner, es gibt noch keinen Nachweis'
              ) : duty.state === 'overdue' ? (
                <span className="font-semibold text-conflict">
                  {date(duty.appointment.dueOn)}, überfällig
                </span>
              ) : (
                date(duty.appointment.dueOn)
              ),
          },
          ...(contractor === null ? [] : [{ label: 'Fremdfirma', value: contractor }]),
          ...(duty.asset === null
            ? []
            : [
                {
                  label: 'Anlage',
                  value: (
                    <Link to={officePlaces.asset(duty.asset.id)} className={factLink}>
                      {where}
                    </Link>
                  ),
                },
              ]),
        ]}
      />
    </Panel>
  )

  if (unwelcome !== null) {
    return (
      <Screen>
        <PageHead title="Bericht eintragen" crumbs={crumbs} phoneBack={dutyCrumb} sub={sub} />
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Empty>{unwelcome}</Empty>
          {side}
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <PageHead title="Bericht eintragen" crumbs={crumbs} phoneBack={dutyCrumb} sub={sub} />
      <form
        noValidate
        className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <Panel roomy>
            <div className="flex flex-col gap-3.5">
              <input
                ref={picker}
                type="file"
                className="sr-only"
                aria-label="Datei wählen"
                tabIndex={-1}
                onChange={(event) => {
                  choose(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-ink max-lg:text-[15px]">
                  Bericht oder Prüfbescheinigung{' '}
                  <span aria-hidden="true" className="text-conflict">
                    *
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-dashed border-line-strong bg-surface-sunken px-3 py-2.5">
                  <FileText
                    size={22}
                    strokeWidth={1.9}
                    aria-hidden="true"
                    className="shrink-0 text-ink-muted"
                  />
                  <div className="min-w-0 grow leading-[1.35]">
                    {file === null ? (
                      <span className="text-[14px] text-ink-muted">{reportWords.noFile}</span>
                    ) : (
                      <>
                        <div className="text-[14px] font-medium [overflow-wrap:anywhere]">
                          {file.name}
                        </div>
                        <div className="text-[12px] text-ink-faint">{fileSize(file.size)}</div>
                      </>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="small"
                    disabled={working}
                    onClick={() => {
                      picker.current?.click()
                    }}
                  >
                    {file === null ? 'Datei wählen' : 'Andere Datei'}
                  </Button>
                </div>
                {problems['file'] ? (
                  <p role="alert" className="text-[13px] font-semibold text-conflict">
                    {problems['file']}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field
                  label="Prüfer"
                  required
                  starred
                  maxLength={evidenceLimits.examiner}
                  value={examiner}
                  problem={problems['examiner']}
                  onChange={(event) => {
                    setExaminer(event.target.value)
                  }}
                />
                <Field
                  label="Organisation"
                  required
                  starred
                  maxLength={evidenceLimits.examinerOrganisation}
                  value={organisation}
                  problem={problems['examinerOrganisation']}
                  onChange={(event) => {
                    setOrganisation(event.target.value)
                  }}
                />
              </div>
              <div className="sm:w-[170px]">
                <Field
                  label="Tag der Durchführung"
                  type="date"
                  required
                  starred
                  max={today()}
                  value={performedOn}
                  problem={problems['performedOn']}
                  onChange={(event) => {
                    setPerformedOn(event.target.value)
                  }}
                />
              </div>
              <Choice<EvidenceResult>
                label="Ergebnis"
                value={result}
                disabled={working}
                onChange={(chosen) => {
                  setResult(chosen)

                  // "Mit Mängeln" names one at least: a row to fill in.
                  if (chosen === 'with_defects' && defects.length === 0) {
                    setDefects([{ key: nextKey, description: '', defectClass: '', dueOn: '' }])
                    setNextKey(nextKey + 1)
                  }
                }}
                options={(
                  ['without_defects', 'with_defects', 'failed', 'not_performed'] as const
                ).map((each) => ({
                  value: each,
                  label: evidenceResultLabel[each],
                  ...(reportWords.resultNotes[each] === undefined
                    ? {}
                    : { note: reportWords.resultNotes[each] }),
                }))}
              />
              {problems['result'] ? (
                <p role="alert" className="text-[13px] font-semibold text-conflict">
                  {problems['result']}
                </p>
              ) : null}
              {result === 'not_performed' ? (
                <Field
                  label="Warum nicht durchgeführt"
                  required
                  starred
                  maxLength={evidenceLimits.resultReason}
                  value={resultReason}
                  problem={problems['resultReason']}
                  onChange={(event) => {
                    setResultReason(event.target.value)
                  }}
                />
              ) : null}
            </div>
          </Panel>
          {namesDefects ? (
            <Panel
              title="Mängel aus dem Bericht"
              action={
                <Button
                  type="button"
                  size="small"
                  icon={Plus}
                  disabled={working}
                  onClick={() => {
                    setDefects([
                      ...defects,
                      { key: nextKey, description: '', defectClass: '', dueOn: '' },
                    ])
                    setNextKey(nextKey + 1)
                  }}
                >
                  Mangel hinzufügen
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                {defects.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">{reportWords.noDefect}</p>
                ) : null}
                {defects.map((row, index) => (
                  <div
                    key={row.key}
                    role="group"
                    aria-label={`Mangel ${String(index + 1)}`}
                    className="grid items-start gap-2.5 border-b border-line pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_150px_160px_auto]"
                  >
                    <Field
                      label="Beschreibung"
                      required
                      starred
                      value={row.description}
                      problem={problems[reportDefectField(index, 'description')]}
                      onChange={(event) => {
                        changeDefect(row.key, { description: event.target.value })
                      }}
                    />
                    <SelectField
                      label="Klasse"
                      value={row.defectClass}
                      options={[
                        { value: '', label: reportWords.withoutClass },
                        ...classes.map((each) => ({
                          value: each.defectClass.key,
                          label: each.defectClass.label,
                        })),
                      ]}
                      problem={problems[reportDefectField(index, 'defectClass')]}
                      onChange={(chosen) => {
                        changeDefect(row.key, { defectClass: chosen })
                      }}
                    />
                    <Field
                      label="Frist zur Beseitigung"
                      type="date"
                      value={row.dueOn}
                      problem={problems[reportDefectField(index, 'dueOn')]}
                      onChange={(event) => {
                        changeDefect(row.key, { dueOn: event.target.value })
                      }}
                    />
                    <div className="sm:pt-[22px]">
                      <Button
                        type="button"
                        size="small"
                        icon={Trash2}
                        disabled={working}
                        aria-label={`Mangel ${String(index + 1)} entfernen`}
                        onClick={() => {
                          setDefects(defects.filter((each) => each.key !== row.key))
                        }}
                      >
                        Entfernen
                      </Button>
                    </div>
                  </div>
                ))}
                {problems['defects'] ? (
                  <p role="alert" className="text-[13px] font-semibold text-conflict">
                    {problems['defects']}
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}
          <NoteBox>
            {[
              'Mit dem Festschreiben entsteht der Nachweis mit der nächsten Nummer, und die Datei liegt an ihm.',
              next === null
                ? meetsTheDuty(result)
                  ? `Der Termin rückt dann weiter, ${counting}.`
                  : 'Am Termin ändert sich nichts.'
                : `Der Termin rückt auf den ${date(next.dueOn)}, ${counting}.`,
              namesDefects ? 'Die Mängel kommen in die Liste der Mängel.' : null,
              'Eine offene Prüfung dieser Pflicht ist damit erledigt.',
            ]
              .filter(Boolean)
              .join(' ')}
          </NoteBox>
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              disabled={working}
              onClick={() => {
                void navigate({ to: dutyPlaces.duty(duty.id) })
              }}
            >
              Abbrechen
            </Button>
            <Button type="submit" tone="primary" icon={Lock} disabled={working}>
              {working ? 'Einen Moment' : 'Nachweis festschreiben'}
            </Button>
          </div>
        </div>
        {side}
      </form>
    </Screen>
  )
}
