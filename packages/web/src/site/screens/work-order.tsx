import {
  durationOf,
  durationWords,
  finishesWorkOrder,
  type IsoDate,
  type RecordState,
  workOrderKindLabel,
  type WorkOrderDetails,
  type WorkOrderKind,
  workOrderLimits,
  workOrderNoteProblems,
  type WorkOrderUrgency,
  workOrderUrgencyLabel,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, Panel, Status, TextArea } from '@opengewerk/platform-web'
import { clockTime, date, moment, today } from '@opengewerk/platform-web/format'
import { accountQuery, useRight, useWho } from '@opengewerk/platform-web/session'
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
import {
  maybeText,
  refusalFor,
  request,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  Ban,
  Camera,
  Check,
  ClipboardList,
  Clock,
  ImageIcon,
  Pencil,
  Signature,
} from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'

import { beginActivity } from '../../app/answers.js'
import { documentsAt, fileDocument } from '../../app/documents.js'
import { useDutyName } from '../../app/form-of.js'
import { PhotoThumb, useDeferredWrite } from '../../app/form-points.js'
import { titleOfRoom } from '../../app/place-records.js'
import { signActivity } from '../../app/signing.js'
import { assetTitle, NotOnDevice, NotOffered } from '../kit.js'
import { siteForms } from '../places.js'
import { toStart } from './form.js'

export const workOrderWords = {
  number: 'Auftrag',
  order: 'Auftrag',
  where: 'Wo',
  asset: 'Anlage',
  origin: 'Ursprung',
  responsible: 'Verantwortlich',
  you: (name: string) => (name === '' ? 'Sie' : `${name}, Sie`),
  somebodyElse: 'Eine andere Person',
  nobody: 'Noch niemand, das Büro gibt den Auftrag aus',
  fromDefect: (foundOn: string | null, description: string) =>
    foundOn === null ? `Mangel: ${description}` : `Mangel vom ${date(foundOn)}: ${description}`,
  fromDuty: (duty: string) => `Termin: ${duty}`,
  open: 'Offen',
  begun: 'Begonnen',
  waits: 'Wartet auf Abnahme',
  done: 'Erledigt',
  notPerformed: 'Nicht durchgeführt',
  due: (day: IsoDate) => `Frist ${date(day)}`,
  overdue: (day: IsoDate) => `Frist ${date(day)}, überschritten`,
  rejected: (reason: string | null) =>
    reason === null ? 'Im Büro zurückgewiesen.' : `Im Büro zurückgewiesen: ${reason}`,
  protocol: 'Protokoll',
  protocolHint: 'Der Auftrag ist eine Prüfung oder Wartung: das Protokoll gehört dazu.',
  toProtocol: 'Protokoll ausfüllen',
  notes: 'Notizen',
  noNote: 'Noch keine Notiz.',
  writeNote: 'Notiz schreiben',
  notSent: 'noch nicht übertragen',
  photos: 'Fotos',
  noPhoto: 'Noch kein Foto.',
  photo: 'Foto',
  photoField: 'Foto zum Auftrag',
  photoOf: (at: number) => `Foto ${String(at)}`,
  notFiled: 'Das Foto ließ sich nicht ablegen.',
  duration: 'Dauer',
  hours: 'Std.',
  durationHint: 'Aufwand des Auftrags, keine Arbeitszeiterfassung.',
  noDuration: 'nicht angegeben',
  durationShown: (minutes: number) => `${durationWords(minutes)} Std.`,
  close: 'Abschließen',
  onlyYou: 'Nur Sie als verantwortliche Person schließen ab.',
  onlyResponsible: 'Abschließen kann einen Auftrag nur, wer ihn führt.',
  nobodyCloses: 'Diesen Auftrag führt noch niemand. Abschließen kann ihn, wem das Büro ihn gibt.',
  signed: 'Unterschrieben. Der Auftrag wartet auf die Abnahme durch die Objektleitung.',
  closed:
    'Dieser Auftrag ist abgeschlossen. Notizen, Fotos und Dauer lassen sich nicht mehr ändern.',
} as const

export const noteWords = {
  title: 'Notiz',
  field: 'Notiz',
  addPhoto: 'Foto hinzufügen',
  photoField: 'Foto zur Notiz',
  photo: 'Foto zur Notiz',
  hint: 'Jede Notiz ist ein eigener Eintrag mit Ihrem Namen und der Uhrzeit des Geräts. Geändert wird sie danach nicht.',
  cancel: 'Abbrechen',
  save: 'Speichern',
  notTaken: 'Eine Notiz nimmt dieser Auftrag nicht mehr.',
  photoNotFiled:
    'Die Notiz ist gespeichert, ein Foto ließ sich nicht ablegen. Es lässt sich am Auftrag noch einmal aufnehmen.',
} as const

export const closeWords = {
  title: 'Auftrag abschließen',
  summary: 'Zusammenfassung',
  notes: 'Notizen',
  photos: 'Fotos',
  duration: 'Dauer',
  none: 'keine',
  lastNote: (count: number, at: string) => `${String(count)}, die letzte um ${at}`,
  waits: 'Danach wartet der Auftrag auf die Abnahme durch die Objektleitung.',
  remedied: 'Der Mangel steht mit der Unterschrift auf „Behoben“.',
  signature: 'Unterschrift',
  pad: 'Feld für die Unterschrift',
  sign: 'Abschließen und unterschreiben',
} as const

/** Whether a record is there and not marked. */
function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/** The states in which the work on an order goes on, before a signature fixes it. */
const underWay = ['open', 'started']

/**
 * A work order as this device holds it (#118): the activity, what only an
 * order has, its notes and photos, who is signed in, and what may be done
 * with it here. Signed is an order whose signature counts: the server says
 * so with its state, and this device with a signature still in its outbox. A
 * signature the office turned back leaves the order open again.
 */
function useWorkOrder(activityId: string) {
  const client = useSync()
  const activity = useRecord('activities', activityId)
  const order = useRelated('work_orders', 'activityId', activityId).find(live) ?? null
  const notes = useRelated('work_order_notes', 'activityId', activityId).filter(live)
  const signatures = useRelated('activity_signatures', 'activityId', activityId)
  const decisions = useRelated('work_order_decisions', 'workOrderId', String(order?.['id'] ?? ''))
  const documents = useRecords('attachments')
  const me = useQuery(accountQuery).data?.userId ?? ''
  const performs = useRight('activity.perform')
  const records = useRight('document.record')
  const status = text(activity, 'status')
  const sent = signatures.some(
    (signature) =>
      signature['role'] === 'signer' &&
      client.isPending('activity_signatures', String(signature['id'])),
  )
  const signed = status === 'signed' || status === 'done' || sent
  const editable = activity !== null && underWay.includes(status) && !sent && performs
  const propertyId = maybeText(activity, 'propertyId') ?? ''
  const photos = useMemo(
    () =>
      documentsAt(documents, { propertyId, activityId }).filter(
        (document) => live(document) && maybeText(document, 'kind') === null,
      ),
    [documents, propertyId, activityId],
  )
  const written = [...notes].sort((left, right) =>
    text(left, 'writtenAt') < text(right, 'writtenAt') ? -1 : 1,
  )
  const responsible = maybeText(activity, 'responsibleUserId')
  const rejection = [...decisions]
    .filter((decision) => decision['decision'] === 'rejected')
    .sort((left, right) => (text(left, 'decidedAt') < text(right, 'decidedAt') ? 1 : -1))[0]

  return {
    activity,
    order,
    notes: written,
    photos,
    me,
    status,
    signed,
    editable,
    files: editable && records,
    finishes:
      activity !== null &&
      me !== '' &&
      finishesWorkOrder({ kind: 'work_order', responsibleUserId: responsible }, me),
    responsible,
    rejected: underWay.includes(status) && !sent && rejection !== undefined ? rejection : null,
  }
}

/**
 * The names of the people of an order, which a device does not hold: asked
 * from the page of the order in the office while there is a connection, and
 * without one not at all. The order is shown either way.
 */
function useOrderNames(activityId: string, wanted: boolean): WorkOrderDetails | null {
  const { online } = useSyncStatus()

  return (
    useQuery({
      queryKey: ['work-orders', 'page', activityId],
      queryFn: () => request<WorkOrderDetails>(`/work-orders/${activityId}`),
      enabled: online && wanted,
      retry: false,
      staleTime: 60_000,
    }).data ?? null
  )
}

/** Where an order is, in words: the building, and the floor and the room where it hangs on one. */
function usePlaceWords(activity: RecordState | null): string {
  const property = useRecord('properties', maybeText(activity, 'propertyId') ?? undefined)
  const asset = useRecord('assets', maybeText(activity, 'assetId') ?? undefined)
  const room = useRecord(
    'rooms',
    (maybeText(asset, 'roomId') ?? maybeText(activity, 'roomId')) || undefined,
  )
  const building = useRecord(
    'buildings',
    (maybeText(asset, 'buildingId') ??
      maybeText(room, 'buildingId') ??
      maybeText(activity, 'buildingId')) ||
      undefined,
  )
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)

  return [
    maybeText(building, 'name') ?? maybeText(property, 'name'),
    maybeText(floor, 'name'),
    room ? titleOfRoom(room) : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The state of an order as a marker, `status()` of the boards. */
function OrderStatus({ status, signed }: { readonly status: string; readonly signed: boolean }) {
  if (status === 'done') {
    return <Status tone="done">{workOrderWords.done}</Status>
  }

  if (status === 'not_performed') {
    return (
      <Status tone="neutral" icon={Ban}>
        {workOrderWords.notPerformed}
      </Status>
    )
  }

  if (signed) {
    return (
      <Status tone="waiting" icon={Signature}>
        {workOrderWords.waits}
      </Status>
    )
  }

  return status === 'started' ? (
    <Status tone="waiting" icon={Pencil}>
      {workOrderWords.begun}
    </Status>
  ) : (
    <Status tone="neutral" icon={Clock}>
      {workOrderWords.open}
    </Status>
  )
}

/** The head of the screens of an order: its number, and its kind with how urgent it is. */
function headOf(order: RecordState | null): { readonly title: string; readonly sub: string } {
  const kind = maybeText(order, 'kind') as WorkOrderKind | null
  const urgency = maybeText(order, 'urgency') as WorkOrderUrgency | null

  return {
    title: maybeText(order, 'number') ?? workOrderWords.number,
    sub: [
      kind === null ? null : workOrderKindLabel[kind],
      urgency === null || urgency === 'normal' ? null : workOrderUrgencyLabel[urgency],
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/**
 * A work order on site, the board "Auftrag (4.8)": what is to be done, where,
 * what it came of and who answers for it; the notes as entries of their own,
 * the photos, the time spent, and the protocol where the order is an
 * inspection or a maintenance. Everything here goes through the outbox, also
 * without a network, and the first of it begins the order.
 *
 * "Abschließen" stands for the person who answers for the order alone (4.8):
 * the further people write notes, take photos and say the time spent, and
 * the server refuses a signature of anybody else. An order with a form or
 * with duties is finished with its result (#108), every other one on the
 * board "Auftrag abschließen".
 */
export function SiteWorkOrderScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }

  // Keyed by the order, so that what a screen holds of its own begins anew on another one.
  return <WorkOrderOf key={activityId} activityId={activityId} />
}

function WorkOrderOf({ activityId }: { readonly activityId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const work = useWorkOrder(activityId)
  const names = useOrderNames(activityId, work.activity !== null)
  const place = usePlaceWords(work.activity)
  const asset = useRecord('assets', maybeText(work.activity, 'assetId') ?? undefined)
  const defect = useRecord('defects', maybeText(work.order, 'originDefectId') ?? undefined)
  const lines = useRelated('activity_duties', 'activityId', activityId).filter(live)
  const duty = useDutyName(maybeText(lines[0], 'dutyId'))
  const field = useRef<HTMLInputElement>(null)
  const stored = work.order?.['durationMinutes']
  const [trouble, setTrouble] = useState<string | null>(null)

  if (work.activity === null) {
    return <NotOnDevice what="Diesen Auftrag" back={{ to: '/', label: 'Zum Start' }} />
  }

  const activity = work.activity
  const head = headOf(work.order)
  const dueOn = maybeText(activity, 'dueOn') as IsoDate | null
  const late = dueOn !== null && dueOn < today() && underWay.includes(work.status)
  const withForm = maybeText(activity, 'formKey') !== null
  const needsResult = withForm || lines.length > 0
  const responsibleWords =
    work.responsible === null
      ? workOrderWords.nobody
      : work.responsible === work.me
        ? workOrderWords.you(who.name)
        : (names?.responsible?.name ?? workOrderWords.somebodyElse)
  const nameOfNote = (note: RecordState): string | null => {
    const writtenBy = maybeText(note, 'writtenBy')

    if (writtenBy === null || writtenBy === work.me) {
      return who.name === '' ? null : who.name
    }

    return names?.notes.find((line) => line.id === note['id'])?.name ?? null
  }
  const origin =
    defect !== null
      ? workOrderWords.fromDefect(maybeText(defect, 'foundOn'), text(defect, 'description'))
      : duty !== null
        ? workOrderWords.fromDuty(duty)
        : null

  return (
    <>
      <SiteHeader title={head.title} sub={head.sub} back={toStart} />
      <SiteScreen>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[24px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
            {text(activity, 'title')}
          </h2>
          <p className="flex flex-wrap items-center gap-2">
            <OrderStatus status={work.status} signed={work.signed} />
            {dueOn === null ? null : (
              <span
                className={`text-[15px] font-semibold ${late ? 'text-conflict' : 'text-ink-muted'}`}
              >
                {late ? workOrderWords.overdue(dueOn) : workOrderWords.due(dueOn)}
              </span>
            )}
          </p>
        </div>
        {work.rejected === null ? null : (
          <SiteTrouble>{workOrderWords.rejected(maybeText(work.rejected, 'reason'))}</SiteTrouble>
        )}
        <Panel title={workOrderWords.order}>
          <SiteFacts
            facts={[
              ...(place === '' ? [] : [{ label: workOrderWords.where, value: place }]),
              ...(asset === null
                ? []
                : [{ label: workOrderWords.asset, value: assetTitle(asset) }]),
              ...(origin === null ? [] : [{ label: workOrderWords.origin, value: origin }]),
              { label: workOrderWords.responsible, value: responsibleWords },
            ]}
          />
        </Panel>
        {withForm ? (
          <Panel title={workOrderWords.protocol}>
            <div className="flex flex-col gap-2.5">
              <SiteText muted size={15}>
                {workOrderWords.protocolHint}
              </SiteText>
              <Button
                wide
                height={48}
                icon={ClipboardList}
                onClick={() => {
                  void navigate({ to: siteForms.protocol(activityId) })
                }}
              >
                {workOrderWords.toProtocol}
              </Button>
            </div>
          </Panel>
        ) : null}
        <Panel title={workOrderWords.notes}>
          {work.notes.length === 0 ? (
            <SiteText muted>{workOrderWords.noNote}</SiteText>
          ) : (
            <ul aria-label={workOrderWords.notes} className="flex flex-col">
              {work.notes.map((note) => (
                <NoteLine
                  key={String(note['id'])}
                  text={text(note, 'text')}
                  meta={[moment(text(note, 'writtenAt')), nameOfNote(note)]
                    .filter(Boolean)
                    .join(', ')}
                  pending={client.isPending('work_order_notes', String(note['id']))}
                />
              ))}
            </ul>
          )}
          {work.editable ? (
            <div className="pt-3">
              <Button
                wide
                height={48}
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: siteForms.note(activityId) })
                }}
              >
                {workOrderWords.writeNote}
              </Button>
            </div>
          ) : null}
        </Panel>
        <Panel title={workOrderWords.photos}>
          <div className="flex flex-wrap items-stretch gap-2">
            {work.photos.length === 0 && !work.files ? (
              <SiteText muted>{workOrderWords.noPhoto}</SiteText>
            ) : null}
            {work.photos.map((photo, index) => (
              <PhotoThumb
                key={String(photo['id'])}
                attachmentId={String(photo['id'])}
                label={workOrderWords.photoOf(index + 1)}
                compact
              />
            ))}
            {work.files ? (
              <>
                <input
                  ref={field}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  aria-label={workOrderWords.photoField}
                  onChange={(event) => {
                    const file = event.target.files?.[0]

                    // The same photo taken twice is a change of the field again.
                    event.target.value = ''

                    if (!file) {
                      return
                    }

                    setTrouble(null)
                    void (async () => {
                      const begun = await beginActivity(client, activityId)
                      const filed =
                        begun === null
                          ? await fileDocument(
                              client,
                              { propertyId: text(activity, 'propertyId'), activityId },
                              file,
                            ).catch(() => workOrderWords.notFiled)
                          : begun

                      setTrouble(filed)
                    })()
                  }}
                />
                <div className="flex min-h-16 min-w-[96px] grow">
                  <Button
                    wide
                    height={56}
                    icon={Camera}
                    onClick={() => {
                      field.current?.click()
                    }}
                  >
                    {workOrderWords.photo}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </Panel>
        <Panel>
          {work.editable && work.order !== null ? (
            <DurationField
              key={String(work.order['id'])}
              activityId={activityId}
              order={work.order}
              onTrouble={setTrouble}
            />
          ) : (
            <SiteFacts
              facts={[
                {
                  label: workOrderWords.duration,
                  value:
                    typeof stored === 'number'
                      ? workOrderWords.durationShown(stored)
                      : workOrderWords.noDuration,
                },
              ]}
            />
          )}
        </Panel>
        {work.signed && work.status !== 'done' ? (
          <SiteText>{workOrderWords.signed}</SiteText>
        ) : null}
        {!work.editable && !work.signed && !underWay.includes(work.status) ? (
          <SiteText muted>{workOrderWords.closed}</SiteText>
        ) : null}
        {work.editable && !work.finishes ? (
          <SiteText muted>
            {work.responsible === null
              ? workOrderWords.nobodyCloses
              : workOrderWords.onlyResponsible}
          </SiteText>
        ) : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      {work.editable && work.finishes ? (
        <SiteActionBar note={workOrderWords.onlyYou}>
          <Button
            tone="primary"
            wide
            height={60}
            icon={Signature}
            onClick={() => {
              void navigate({
                to: needsResult ? siteForms.result(activityId) : siteForms.close(activityId),
              })
            }}
          >
            {workOrderWords.close}
          </Button>
        </SiteActionBar>
      ) : null}
    </>
  )
}

/**
 * The time spent on an order, as hours and minutes: written a moment after
 * the last key and when the field is left, and the first of it begins the
 * order. Keyed by the order, so that what it starts from is read once the
 * order is on the device.
 */
function DurationField({
  activityId,
  order,
  onTrouble,
}: {
  readonly activityId: string
  readonly order: RecordState
  readonly onTrouble: (trouble: string | null) => void
}) {
  const client = useSync()
  const stored = typeof order['durationMinutes'] === 'number' ? order['durationMinutes'] : null
  const [typed, setTyped] = useState(stored === null ? '' : durationWords(stored))
  const [problem, setProblem] = useState<string | null>(null)
  const write = useDeferredWrite((value: string) => {
    const read = durationOf(value)

    if (typeof read === 'string') {
      setProblem(read)

      return
    }

    setProblem(null)

    const held = client.list('work_orders').find((each) => each['id'] === order['id'])

    if (held === undefined || read.minutes === (held['durationMinutes'] ?? null)) {
      return
    }

    void (async () => {
      const begun = await beginActivity(client, activityId)
      const done =
        begun === null
          ? await client.update('work_orders', String(order['id']), {
              durationMinutes: read.minutes,
            })
          : null

      onTrouble(begun ?? (done?.outcome === 'refused' ? refusalFor(done) : null))
    })()
  })

  return (
    <div onBlur={write.flush}>
      <Field
        label={workOrderWords.duration}
        unit={workOrderWords.hours}
        hint={workOrderWords.durationHint}
        maxLength={7}
        value={typed}
        problem={problem ?? undefined}
        onChange={(event) => {
          setTyped(event.target.value)
          write.put(event.target.value)
        }}
      />
    </div>
  )
}

/** A note in the list of an order: what it says, and when and by whom, or that it waits here. */
function NoteLine({
  text: said,
  meta,
  pending,
}: {
  readonly text: string
  readonly meta: string
  readonly pending: boolean
}) {
  return (
    <li className="border-b border-row py-2.5 last:border-b-0">
      <p className="text-[17px] leading-[1.4] whitespace-pre-line [overflow-wrap:anywhere]">
        {said}
      </p>
      <p className="mt-[3px] text-[14px] text-ink-muted">
        {meta}
        {pending ? (
          <span className="font-semibold text-waiting">{` · ${workOrderWords.notSent}`}</span>
        ) : null}
      </p>
    </li>
  )
}

/**
 * A note on a work order, the board "Notiz (4.8)": what is said, and photos
 * to go with it, saved together as an entry with the name of whoever is
 * signed in and the time of the device, also without a network. A photo
 * taken here waits until the note is saved and hangs on the order, beside
 * the others; a note that is not saved takes none with it. Once saved, the
 * note is changed no more.
 */
export function SiteNoteScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const client = useSync()
  const navigate = useNavigate()
  const work = useWorkOrder(activityId)
  const field = useRef<HTMLInputElement>(null)
  const [said, setSaid] = useState('')
  const [photos, setPhotos] = useState<readonly File[]>([])
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const back = { to: siteForms.form(activityId), label: 'Zurück zum Auftrag' }

  if (work.activity === null) {
    return <NotOnDevice what="Diesen Auftrag" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (!work.editable) {
    return (
      <NotOffered title={noteWords.title} back={back}>
        {noteWords.notTaken}
      </NotOffered>
    )
  }

  const activity = work.activity

  async function save() {
    const trimmed = said.trim()
    const writtenAt = new Date().toISOString()
    const wrong = Object.values(workOrderNoteProblems({ text: trimmed, writtenAt }))[0]

    if (wrong !== undefined) {
      setTrouble(wrong)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const begun = await beginActivity(client, activityId)

      if (begun !== null) {
        setTrouble(begun)

        return
      }

      const made = await client.create('work_order_notes', { activityId, text: trimmed, writtenAt })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      let lost = false

      for (const photo of photos) {
        const filed = await fileDocument(
          client,
          { propertyId: text(activity, 'propertyId'), activityId },
          photo,
        ).catch(() => noteWords.photoNotFiled)

        lost = lost || filed !== null
      }

      if (lost) {
        setTrouble(noteWords.photoNotFiled)

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
        title={noteWords.title}
        sub={[maybeText(work.order, 'number'), text(activity, 'title')].filter(Boolean).join(' ')}
        back={back}
      />
      <SiteScreen gap={14}>
        <TextArea
          label={noteWords.field}
          rows={4}
          maxLength={workOrderLimits.note}
          value={said}
          onChange={(event) => {
            setSaid(event.target.value)
          }}
        />
        <div className="flex items-center gap-2.5">
          {photos.map((photo, index) => (
            <PickedPhoto
              key={`${photo.name}-${String(index)}`}
              label={`${noteWords.photo} ${String(index + 1)}`}
            />
          ))}
          {photos.length === 0 ? (
            <span
              aria-hidden="true"
              className="flex h-16 w-[84px] shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface-sunken text-ink-faint"
            >
              <ImageIcon size={22} strokeWidth={1.8} />
            </span>
          ) : null}
          {work.files ? (
            <>
              <input
                ref={field}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                aria-label={noteWords.photoField}
                onChange={(event) => {
                  const file = event.target.files?.[0]

                  event.target.value = ''

                  if (file) {
                    setPhotos((before) => [...before, file])
                  }
                }}
              />
              <div className="flex grow">
                <Button
                  wide
                  height={52}
                  icon={Camera}
                  onClick={() => {
                    field.current?.click()
                  }}
                >
                  {noteWords.addPhoto}
                </Button>
              </div>
            </>
          ) : null}
        </div>
        <SiteText muted size={15}>
          {noteWords.hint}
        </SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar>
        <div className="min-w-0 flex-[1_1_auto]">
          <Button
            wide
            height={60}
            onClick={() => {
              void navigate({ to: back.to })
            }}
          >
            {noteWords.cancel}
          </Button>
        </div>
        <div className="min-w-0 flex-[2_1_auto]">
          <Button
            tone="primary"
            wide
            height={60}
            icon={Check}
            disabled={working || said.trim() === ''}
            onClick={() => {
              void save()
            }}
          >
            {noteWords.save}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}

/**
 * A photo taken for a note, which waits on this device until the note is
 * saved: a tile with its number, as the board draws it. Its bytes are not
 * shown back from the file field; the photo is seen once it is filed.
 */
function PickedPhoto({ label }: { readonly label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="flex h-16 w-[84px] shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface-sunken text-ink-faint"
    >
      <ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />
    </span>
  )
}

/**
 * Finishing a work order on site, the board "Auftrag abschließen (4.8)": what
 * the order holds in a few words, what follows, and the signature of the
 * person who answers for it, for the page as this device holds it. It goes
 * through the outbox, also without a network; the server takes it for the
 * same page and from the same person only.
 */
export function SiteCloseOrderScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const work = useWorkOrder(activityId)
  const [path, setPath] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const back = { to: siteForms.form(activityId), label: 'Zurück zum Auftrag' }

  if (work.activity === null) {
    return <NotOnDevice what="Diesen Auftrag" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (!work.editable || !work.finishes) {
    return (
      <NotOffered title={closeWords.title} back={back}>
        {!work.editable
          ? workOrderWords.closed
          : work.responsible === null
            ? workOrderWords.nobodyCloses
            : workOrderWords.onlyResponsible}
      </NotOffered>
    )
  }

  const last = work.notes[work.notes.length - 1]
  const minutes = work.order?.['durationMinutes']

  async function sign() {
    if (path === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      // An order opened only to be finished has no day yet.
      const problem =
        (await beginActivity(client, activityId)) ?? (await signActivity(client, activityId, path))

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
        title={closeWords.title}
        sub={maybeText(work.order, 'number') ?? undefined}
        back={back}
      />
      <SiteScreen>
        <Panel title={closeWords.summary}>
          <SiteFacts
            facts={[
              {
                label: closeWords.notes,
                value:
                  last === undefined
                    ? closeWords.none
                    : closeWords.lastNote(
                        work.notes.length,
                        clockTime(new Date(text(last, 'writtenAt'))),
                      ),
              },
              {
                label: closeWords.photos,
                value: work.photos.length === 0 ? closeWords.none : String(work.photos.length),
              },
              {
                label: closeWords.duration,
                value:
                  typeof minutes === 'number'
                    ? workOrderWords.durationShown(minutes)
                    : workOrderWords.noDuration,
              },
            ]}
          />
        </Panel>
        <SiteText>
          {[
            closeWords.waits,
            maybeText(work.order, 'originDefectId') === null ? null : closeWords.remedied,
          ]
            .filter(Boolean)
            .join(' ')}
        </SiteText>
        <SignedBy name={[who.name, who.roles].filter(Boolean).join(', ')}>
          <SignaturePad label={closeWords.pad} onChange={setPath} />
        </SignedBy>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Signature}
          disabled={working || path === null}
          onClick={() => {
            void sign()
          }}
        >
          {closeWords.sign}
        </Button>
      </SiteActionBar>
    </>
  )
}

/** The field of a signature with its label above and the name of whoever signs below. */
function SignedBy({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SiteLabel>{closeWords.signature}</SiteLabel>
      {children}
      {name === '' ? null : <p className="text-[16px] font-semibold">{name}</p>}
    </div>
  )
}
