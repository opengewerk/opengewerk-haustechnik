import {
  type FaultCategory,
  type FaultLabelAnswer,
  type FaultPlaceChoice,
  faultPlaceLine,
  faultReportLimits,
  faultReportProblems,
  type FaultReportState,
  faultReportStateLabel,
  type IsoDate,
  labelCodeFromScan,
  type OwnFaultReport,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel, SelectField, TextArea } from '@opengewerk/platform-web'
import { date, moment, today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteLabel,
  SiteScreen,
  SiteText,
  SiteTrouble,
  TopTitle,
} from '@opengewerk/platform-web/site'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  Building2,
  Camera,
  Check,
  ChevronRight,
  DoorOpen,
  MessageSquareWarning,
  Plus,
  ScanLine,
  WifiOff,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import { FaultPhoto } from '../app/fault-photo.js'
import { NotOffered } from './kit.js'
import { ScanCamera, ScanMessage, scanLooks } from './screens/scan.js'
import { longDay } from './start-items.js'

// Reporting a fault with an account on site (#331, section 4.7 of the
// concept, the boards of the row "Melder" on the page "Vor Ort"). The role
// Melder works here and only here; every other role that reports comes from
// the menu. The device holds nothing of the operator for a Melder, so every
// screen asks the server: the own reports, the buildings and rooms by their
// names, what a label stands for. Reporting needs a network and says so.

/** Where reporting lives on site. */
export const reportingPlaces = {
  start: '/meldungen',
  report: '/stoerung',
  place: '/stoerung/ort',
  reported: '/stoerung/gemeldet',
  own: (id: string) => `/meldungen/${id}`,
} as const

export const reportingWords = {
  title: 'Störungen',
  report: 'Störung melden',
  scan: 'Etikett scannen',
  own: 'Meine Meldungen',
  none: 'Sie haben noch keine Störung gemeldet.',
  loading: 'Ihre Meldungen werden geladen.',
  failed: 'Ihre Meldungen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  feedback:
    'Bei Annahme und Erledigung bekommen Sie Bescheid, auch als Push, wenn Sie ihn eingeschaltet haben.',
  offline: 'Melden geht mit Verbindung',
  offlineText:
    'Ihre Meldung geht direkt an den Server, und Ihre Liste kommt von dort. Sobald das Gerät wieder verbunden ist, geht es weiter.',
  withNetwork: 'mit Verbindung',
  where: 'Wo',
  byLabel: 'Über das Etikett.',
  otherPlace: 'Anderen Ort wählen',
  choosePlace: 'Ort wählen',
  noPlace: 'Wählen Sie, wo die Störung ist: über das Etikett oder aus der Liste.',
  category: 'Kategorie',
  description: 'Beschreibung',
  takePhoto: 'Foto aufnehmen',
  retakePhoto: 'Anderes Foto',
  photoField: 'Foto der Störung',
  nobodyNamed:
    'Die Objektleitung Ihres Bereichs sieht die Meldung, ohne Ihren Namen. Wer gemeldet hat, steht im Änderungsprotokoll.',
  check: 'Bitte prüfen Sie die markierten Felder.',
  photoFailed: 'Das Foto ließ sich nicht senden. Versuchen Sie es noch einmal.',
  mayNot: 'Störungen melden gehört nicht zu den Rechten dieses Zugangs.',
  placeTitle: 'Wo ist die Störung?',
  placeSub: 'Gebäude und Räume Ihrer Bereiche',
  placeSearch: 'Raum suchen',
  placeSearchHint: 'Name oder Nummer des Raums',
  wholeBuilding: 'Das ganze Gebäude',
  noRooms: 'In Ihren Bereichen gibt es keinen Raum, der so heißt.',
  placesFailed:
    'Die Gebäude und Räume ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  reported: 'Gemeldet',
  reportedText:
    'Die Objektleitung Ihres Bereichs sieht die Meldung jetzt. Sie bekommen Bescheid, wenn sie angenommen und wenn sie erledigt ist.',
  another: 'Noch eine melden',
  ownTitle: 'Meine Meldung',
  ownNotThere: 'Diese Meldung gibt es nicht unter Ihren Meldungen.',
  behind: 'Wer die Störung behebt und wann, steht im Auftrag dahinter, den nur das Büro sieht.',
  reason: 'Grund',
  stillOpen: 'Sie bekommen Bescheid',
} as const

const ownKey = ['fault-reports', 'mine'] as const

/** The own reports, the newest first. */
function useOwnReports() {
  return useQuery({
    queryKey: ownKey,
    queryFn: () => request<readonly OwnFaultReport[]>('/fault-reports/mine'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
}

/** "16.10., 07:52": the moment a report came in, as the cards say it. */
function shortMoment(at: string): string {
  return moment(at).replace(/\.\d{4},/, '.,')
}

const edges: Readonly<Record<FaultReportState, string>> = {
  received: 'border-l-control',
  accepted: 'border-l-copper',
  done: 'border-l-done',
  rejected: 'border-l-control',
  merged: 'border-l-control',
}

/** What a card says under the place: how far the report is. */
function metaOf(report: OwnFaultReport): {
  readonly text: string
  readonly tone: 'muted' | 'conflict'
} {
  switch (report.state) {
    case 'received':
    case 'merged':
      return { text: 'Liegt bei der Objektleitung', tone: 'muted' }
    case 'accepted':
      return { text: 'Wird bearbeitet', tone: 'muted' }
    case 'done':
      return {
        text: report.doneAt === null ? 'Erledigt' : `Erledigt am ${date(report.doneAt)}`,
        tone: 'muted',
      }
    case 'rejected':
      return { text: `Grund: ${report.rejectionReason ?? ''}`, tone: 'conflict' }
  }
}

function OwnCard({ report }: { readonly report: OwnFaultReport }) {
  const meta = metaOf(report)
  // A merged report is told what the one it went into is told; for the person it is still received.
  const state = report.state === 'merged' ? 'received' : report.state

  return (
    <Link
      to={reportingPlaces.own(report.id)}
      className={`block rounded-[6px] border border-l-4 border-line bg-surface py-[11px] pr-3.5 pl-4 text-ink no-underline ${edges[state]}`}
    >
      <p className="font-condensed text-[14px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
        {`${faultReportStateLabel[state]} · ${shortMoment(report.receivedAt)}`}
      </p>
      <p className="mt-px line-clamp-2 text-[18px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
        {report.description}
      </p>
      <p className="mt-0.5 text-[15px] text-ink-muted">{faultPlaceLine(report.words)}</p>
      <p
        className={`mt-0.5 text-[15px] ${meta.tone === 'conflict' ? 'font-semibold text-conflict' : 'text-ink-muted'}`}
      >
        {meta.text}
      </p>
    </Link>
  )
}

/** The note a screen shows without a network. */
function Offline() {
  return (
    <section
      role="status"
      className="rounded-[8px] border border-waiting-edge bg-waiting-fill p-3.5"
    >
      <h2 className="flex items-center gap-2.5 text-[18px] font-bold text-waiting">
        <WifiOff size={22} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
        {reportingWords.offline}
      </h2>
      <p className="mt-1.5 text-[16px] leading-[1.45] text-ink">{reportingWords.offlineText}</p>
    </section>
  )
}

/**
 * The start of a Melder, and "Meine Meldungen" from the menu for every other
 * role that reports (`melder_start()` of the boards): reporting first, then
 * the own reports with their state.
 */
export function ReporterStartScreen() {
  const reports = useRight('fault.report')
  const own = useOwnReports()
  const navigate = useNavigate()
  const offline = own.fetchStatus === 'paused' && own.data === undefined

  if (!reports) {
    return (
      <NotOffered title={reportingWords.title} back={{ to: '/', label: 'Zum Start' }}>
        {reportingWords.mayNot}
      </NotOffered>
    )
  }

  return (
    <SiteScreen gap={10}>
      <TopTitle over={longDay(today() as IsoDate)} title={reportingWords.title} />
      {offline ? <Offline /> : null}
      <Button
        tone="primary"
        wide
        height={56}
        icon={Plus}
        onClick={() => {
          void navigate({ to: reportingPlaces.report })
        }}
      >
        {reportingWords.report}
      </Button>
      <Button
        wide
        height={56}
        icon={ScanLine}
        onClick={() => {
          void navigate({ to: '/scannen' })
        }}
      >
        {reportingWords.scan}
      </Button>
      <section aria-label={reportingWords.own} className="flex flex-col gap-2">
        <SiteLabel>{reportingWords.own}</SiteLabel>
        {own.data === undefined ? (
          offline ? null : (
            <SiteText muted>
              {own.isError ? reportingWords.failed : reportingWords.loading}
            </SiteText>
          )
        ) : own.data.length === 0 ? (
          <SiteText muted>{reportingWords.none}</SiteText>
        ) : (
          own.data.map((report) => <OwnCard key={report.id} report={report} />)
        )}
      </section>
      <SiteText muted size={15}>
        {reportingWords.feedback}
      </SiteText>
    </SiteScreen>
  )
}

/** The places of the own areas, by their names. */
function usePlaces() {
  return useQuery({
    queryKey: ['fault-reports', 'places'],
    queryFn: () => request<readonly FaultPlaceChoice[]>('/fault-reports/places'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
}

/** What a label stands for, asked once per code. */
function labelQuery(code: string) {
  return {
    queryKey: ['fault-reports', 'label', code],
    queryFn: () => request<FaultLabelAnswer>(`/fault-reports/label/${encodeURIComponent(code)}`),
    staleTime: 5 * 60_000,
  } as const
}

/** The place a report is made at, from the address: a label, a room or a building. */
interface ChosenPlace {
  readonly ids: {
    readonly buildingId?: string
    readonly roomId?: string
    readonly assetId?: string
  }
  readonly title: string
  readonly sub: string
  readonly byLabel: boolean
}

function useChosenPlace(search: Readonly<Record<string, unknown>>): ChosenPlace | null {
  const code = typeof search['etikett'] === 'string' ? search['etikett'] : null
  const roomId = typeof search['raum'] === 'string' ? search['raum'] : null
  const buildingId = typeof search['gebaeude'] === 'string' ? search['gebaeude'] : null
  const label = useQuery({ ...labelQuery(code ?? ''), enabled: code !== null })
  const places = usePlaces()

  return useMemo(() => {
    if (code !== null) {
      const answer = label.data

      if (answer?.standing !== 'open') {
        return null
      }

      return {
        ids: {
          buildingId: answer.place.buildingId,
          ...(answer.place.assetId === null ? {} : { assetId: answer.place.assetId }),
          ...(answer.place.roomId === null ? {} : { roomId: answer.place.roomId }),
        },
        title: answer.words.room ?? answer.words.building,
        sub:
          answer.words.room === null
            ? answer.words.property
            : `${answer.words.property}, ${answer.words.building}`,
        byLabel: true,
      }
    }

    const building = (places.data ?? []).find(
      (each) =>
        each.buildingId === buildingId ||
        (roomId !== null && each.rooms.some((room) => room.id === roomId)),
    )

    if (building === undefined) {
      return null
    }

    const room = building.rooms.find((each) => each.id === roomId)

    return room === undefined
      ? {
          ids: { buildingId: building.buildingId },
          title: building.building,
          sub: building.property,
          byLabel: false,
        }
      : {
          ids: { roomId: room.id },
          title: room.name,
          sub: `${building.property}, ${building.building}`,
          byLabel: false,
        }
  }, [code, roomId, buildingId, label.data, places.data])
}

/** The hash of a photo, as the server holds it against the bytes. */
async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Sends a photo ahead of the report and answers with its hash. */
async function sendPhoto(photo: File): Promise<string> {
  const bytes = await photo.arrayBuffer()
  const sha256 = await sha256Of(bytes)

  await request(`/fault-reports/photos/${sha256}`, {
    method: 'PUT',
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Media-Type': photo.type === '' ? 'image/jpeg' : photo.type,
    },
  })

  return sha256
}

/**
 * The photo just taken, drawn onto a canvas and cut to fill it. Drawn and not
 * linked: what the picker hands over never becomes an address on the page,
 * and there is no address to give back afterwards either.
 */
function PhotoPreview({ photo, label }: { readonly photo: Blob; readonly label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true

    if (typeof createImageBitmap !== 'function') {
      return undefined
    }

    createImageBitmap(photo).then(
      (bitmap) => {
        const target = canvas.current
        const context = target?.getContext('2d')

        if (live && target && context) {
          const scale = Math.max(target.width / bitmap.width, target.height / bitmap.height)
          const width = bitmap.width * scale
          const height = bitmap.height * scale

          context.clearRect(0, 0, target.width, target.height)
          context.drawImage(
            bitmap,
            (target.width - width) / 2,
            (target.height - height) / 2,
            width,
            height,
          )
        }

        bitmap.close()
      },
      () => undefined,
    )

    return () => {
      live = false
    }
  }, [photo])

  return (
    <canvas
      ref={canvas}
      width={168}
      height={128}
      role="img"
      aria-label={label}
      className="h-16 w-[84px] shrink-0 rounded-[4px] border border-line bg-surface-sunken"
    />
  )
}

/**
 * "Störung melden", `stoerung_melden()` of the boards: the place from the
 * label or the list, the category, the description and a photo. It goes to
 * the server at once, with a network; the place came there the same way.
 */
export function ReportFaultScreen() {
  const search = useSearch({ strict: false })
  const reports = useRight('fault.report')
  const place = useChosenPlace(search)
  const navigate = useNavigate()
  const queries = useQueryClient()
  const categories = useQuery({
    queryKey: ['fault-reports', 'categories'],
    queryFn: () => request<readonly FaultCategory[]>('/fault-reports/categories'),
    enabled: reports,
  })
  const picker = useRef<HTMLInputElement>(null)
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const back = { to: reportingPlaces.start, label: 'Zu meinen Meldungen' }

  if (!reports) {
    return (
      <NotOffered title={reportingWords.report} back={back}>
        {reportingWords.mayNot}
      </NotOffered>
    )
  }

  async function report(event?: FormEvent) {
    event?.preventDefault()
    setTrouble(null)

    const wanted = { categoryId, description: description.trim(), ...(place?.ids ?? {}) }
    const wrong = faultReportProblems(wanted)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(wrong['place'] === undefined ? reportingWords.check : reportingWords.noPlace)

      return
    }

    setWorking(true)

    try {
      let photoSha256: string | null = null

      if (photo !== null) {
        try {
          photoSha256 = await sendPhoto(photo)
        } catch (error) {
          setTrouble(error instanceof RequestRefused ? error.message : reportingWords.photoFailed)

          return
        }
      }

      const made = await request<{ readonly id: string }>('/fault-reports', {
        method: 'POST',
        body: JSON.stringify({ ...wanted, photoSha256 }),
      })

      await queries.invalidateQueries({ queryKey: ownKey })
      void navigate({ to: reportingPlaces.reported, search: { meldung: made.id } })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused
          ? error.message
          : `${reportingWords.offline}. ${reportingWords.offlineText}`,
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void report(event)
      }}
    >
      <SiteHeader title={reportingWords.report} sub={reportingWords.withNetwork} back={back} />
      <SiteScreen>
        <Panel title={reportingWords.where}>
          {place === null ? (
            <div className="flex flex-col gap-2.5">
              <SiteText muted size={15}>
                {reportingWords.noPlace}
              </SiteText>
              <div className="flex flex-wrap gap-2">
                <Button
                  icon={ScanLine}
                  height={48}
                  onClick={() => {
                    void navigate({ to: '/scannen' })
                  }}
                >
                  {reportingWords.scan}
                </Button>
                <Button
                  icon={Building2}
                  height={48}
                  onClick={() => {
                    void navigate({ to: reportingPlaces.place })
                  }}
                >
                  {reportingWords.choosePlace}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 text-ink-muted" aria-hidden="true">
                  {place.ids.buildingId !== undefined &&
                  place.ids.roomId === undefined &&
                  place.ids.assetId === undefined ? (
                    <Building2 size={22} />
                  ) : (
                    <DoorOpen size={22} />
                  )}
                </span>
                <div className="min-w-0 grow">
                  <div className="text-[17px] font-semibold [overflow-wrap:anywhere]">
                    {place.title}
                  </div>
                  <div className="text-[15px] text-ink-muted">{place.sub}</div>
                </div>
              </div>
              {place.byLabel ? (
                <SiteText muted size={15}>
                  {reportingWords.byLabel}
                </SiteText>
              ) : null}
              <Link to={reportingPlaces.place} className="text-[16px] font-semibold">
                {reportingWords.otherPlace}
              </Link>
            </div>
          )}
        </Panel>
        <SelectField
          label={reportingWords.category}
          required
          starred
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: '', label: 'Bitte wählen' },
            ...(categories.data ?? []).map((category) => ({
              value: category.id,
              label: category.name,
            })),
          ]}
          {...(problems['categoryId'] ? { problem: problems['categoryId'] } : {})}
        />
        <TextArea
          label={reportingWords.description}
          rows={4}
          required
          starred
          maxLength={faultReportLimits.description}
          value={description}
          problem={problems['description']}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
        <div className="flex items-center gap-2.5">
          {photo === null ? null : <PhotoPreview photo={photo} label={reportingWords.photoField} />}
          <Button
            icon={Camera}
            height={52}
            disabled={working}
            onClick={() => {
              picker.current?.click()
            }}
          >
            {photo === null ? reportingWords.takePhoto : reportingWords.retakePhoto}
          </Button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label={reportingWords.photoField}
            onChange={(event) => {
              setPhoto(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
        </div>
        <SiteText muted size={15}>
          {reportingWords.nobodyNamed}
        </SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Check}
          disabled={working}
          onClick={() => {
            void report()
          }}
        >
          Melden
        </Button>
      </SiteActionBar>
    </form>
  )
}

/** A row of the list of places: the whole row is the link. */
function PlaceRow({
  to,
  search,
  title,
  meta,
  icon: Icon,
}: {
  readonly to: string
  readonly search: Record<string, string>
  readonly title: string
  readonly meta: string
  readonly icon: typeof DoorOpen
}) {
  return (
    <li>
      <Link
        to={to}
        search={search}
        className="flex min-h-14 items-center gap-3 border-b border-row px-0.5 py-2 text-ink no-underline"
      >
        <Icon size={22} aria-hidden="true" className="shrink-0 text-ink-muted" />
        <span className="min-w-0 grow">
          <span className="block text-[17px] font-medium [overflow-wrap:anywhere]">{title}</span>
          <span className="mt-0.5 block text-[15px] text-ink-muted">{meta}</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-faint" />
      </Link>
    </li>
  )
}

/**
 * "Wo ist die Störung?", `stoerung_ort()` of the boards: the buildings and
 * rooms of the own areas, by their names only, narrowed by what is typed. A
 * building itself may be chosen as well.
 */
export function FaultPlaceScreen() {
  const places = usePlaces()
  const [typed, setTyped] = useState('')
  const wanted = typed.trim().toLocaleLowerCase('de-DE')
  const shown = (places.data ?? [])
    .map((building) => ({
      ...building,
      rooms:
        wanted === ''
          ? building.rooms
          : building.rooms.filter((room) => room.name.toLocaleLowerCase('de-DE').includes(wanted)),
    }))
    .filter((building) => wanted === '' || building.rooms.length > 0)

  return (
    <>
      <SiteHeader
        title={reportingWords.placeTitle}
        sub={reportingWords.placeSub}
        back={{ to: reportingPlaces.report, label: 'Zurück zum Melden' }}
      />
      <SiteScreen>
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold">{reportingWords.placeSearch}</span>
          <input
            type="search"
            value={typed}
            placeholder={reportingWords.placeSearchHint}
            onChange={(event) => {
              setTyped(event.target.value)
            }}
            className="h-[52px] rounded-[5px] border border-line-strong bg-surface px-3 text-[17px] text-ink"
          />
        </label>
        {places.data === undefined ? (
          places.fetchStatus === 'paused' ? (
            <Offline />
          ) : (
            <SiteText muted>
              {places.isError ? reportingWords.placesFailed : reportingWords.loading}
            </SiteText>
          )
        ) : shown.length === 0 ? (
          <SiteText muted>{reportingWords.noRooms}</SiteText>
        ) : (
          shown.map((building) => (
            <section key={building.buildingId} className="flex flex-col gap-1">
              <SiteLabel>{`${building.property} · ${building.building}`}</SiteLabel>
              <ul>
                {wanted === '' ? (
                  <PlaceRow
                    to={reportingPlaces.report}
                    search={{ gebaeude: building.buildingId }}
                    title={reportingWords.wholeBuilding}
                    meta={building.building}
                    icon={Building2}
                  />
                ) : null}
                {building.rooms.map((room) => (
                  <PlaceRow
                    key={room.id}
                    to={reportingPlaces.report}
                    search={{ raum: room.id }}
                    title={room.name}
                    meta={room.floor}
                    icon={DoorOpen}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </SiteScreen>
    </>
  )
}

/** "Gemeldet", `stoerung_gemeldet()` of the boards. */
export function FaultReportedScreen() {
  const search = useSearch({ strict: false })
  const id = typeof search['meldung'] === 'string' ? search['meldung'] : null
  const own = useOwnReports()
  const report = own.data?.find((each) => each.id === id)
  const navigate = useNavigate()

  return (
    <>
      <SiteHeader title={reportingWords.report} />
      <SiteScreen>
        <section
          role="status"
          className="rounded-[8px] border border-done-edge bg-done-fill px-4 py-5 text-center"
        >
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-done text-white">
            <Check size={30} strokeWidth={3} aria-hidden="true" />
          </span>
          <h2 className="mt-2.5 text-[22px] font-bold text-done">{reportingWords.reported}</h2>
          <p className="mt-1 text-[16px] leading-[1.4] text-ink">{reportingWords.reportedText}</p>
          {report === undefined ? null : (
            <p className="mt-1.5 text-[14px] text-ink-muted">{moment(report.receivedAt)}</p>
          )}
        </section>
        {report === undefined ? null : (
          <Panel title="Ihre Meldung">
            <dl className="flex flex-col gap-2.5">
              <div>
                <dt className="font-condensed text-[13px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
                  Was
                </dt>
                <dd className="text-[17px] [overflow-wrap:anywhere]">{report.description}</dd>
              </div>
              <div>
                <dt className="font-condensed text-[13px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
                  Wo
                </dt>
                <dd className="text-[17px]">{faultPlaceLine(report.words)}</dd>
              </div>
            </dl>
          </Panel>
        )}
      </SiteScreen>
      <SiteActionBar>
        <div className="flex w-full gap-2">
          <Button
            wide
            height={60}
            icon={Plus}
            onClick={() => {
              void navigate({ to: reportingPlaces.report })
            }}
          >
            {reportingWords.another}
          </Button>
          <Button
            tone="primary"
            wide
            height={60}
            icon={MessageSquareWarning}
            onClick={() => {
              void navigate({ to: reportingPlaces.start })
            }}
          >
            {reportingWords.own}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}

/** One step of the state of an own report, with the line to the next. */
function Step({
  title,
  meta,
  reached,
  last = false,
}: {
  readonly title: string
  readonly meta: string
  readonly reached: boolean
  readonly last?: boolean
}) {
  return (
    <li className="flex min-h-[58px] gap-3">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
            reached ? 'border-done bg-done text-white' : 'border-control bg-surface'
          }`}
        >
          {reached ? <Check size={13} strokeWidth={3} /> : null}
        </span>
        {last ? null : (
          <span
            aria-hidden="true"
            className={`my-0.5 w-0.5 grow ${reached ? 'bg-done' : 'bg-line'}`}
          />
        )}
      </div>
      <div>
        <div className={`text-[17px] font-semibold ${reached ? 'text-ink' : 'text-ink-muted'}`}>
          {title}
          <span className="sr-only">{reached ? ', erreicht' : ', noch nicht'}</span>
        </div>
        <div className="text-[15px] text-ink-muted">{meta}</div>
      </div>
    </li>
  )
}

/** "Meine Meldung", `meine_meldung()` of the boards: its state as three steps and what was reported. */
export function OwnReportScreen() {
  const { faultReportId } = useParams({ strict: false }) as { faultReportId?: string }
  const own = useOwnReports()
  const report = own.data?.find((each) => each.id === faultReportId)
  const back = { to: reportingPlaces.start, label: 'Zu meinen Meldungen' }

  if (report === undefined) {
    return (
      <>
        <SiteHeader title={reportingWords.ownTitle} back={back} />
        <SiteScreen>
          {own.fetchStatus === 'paused' ? (
            <Offline />
          ) : (
            <SiteText muted>
              {own.data === undefined
                ? own.isError
                  ? reportingWords.failed
                  : reportingWords.loading
                : reportingWords.ownNotThere}
            </SiteText>
          )}
        </SiteScreen>
      </>
    )
  }

  const state = report.state === 'merged' ? 'received' : report.state

  return (
    <>
      <SiteHeader title={reportingWords.ownTitle} sub={report.category} back={back} />
      <SiteScreen>
        <h1 className="text-[24px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
          {`${report.category}, ${faultPlaceLine(report.words)}`}
        </h1>
        <Panel title="Stand">
          {state === 'rejected' ? (
            <div className="flex flex-col gap-1">
              <div className="text-[17px] font-semibold text-conflict">
                {faultReportStateLabel.rejected}
              </div>
              <div className="text-[16px]">{`${reportingWords.reason}: ${report.rejectionReason ?? ''}`}</div>
            </div>
          ) : (
            <ol aria-label="Stand der Meldung">
              <Step
                title={faultReportStateLabel.received}
                meta={moment(report.receivedAt)}
                reached
              />
              <Step
                title={faultReportStateLabel.accepted}
                meta={
                  report.acceptedAt === null ? reportingWords.stillOpen : moment(report.acceptedAt)
                }
                reached={state === 'accepted' || state === 'done'}
              />
              <Step
                title={faultReportStateLabel.done}
                meta={report.doneAt === null ? reportingWords.stillOpen : moment(report.doneAt)}
                reached={state === 'done'}
                last
              />
            </ol>
          )}
        </Panel>
        <Panel title="Gemeldet">
          <dl className="flex flex-col gap-2.5">
            <div>
              <dt className="font-condensed text-[13px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
                Wo
              </dt>
              <dd className="text-[17px]">{`${report.words.property}, ${faultPlaceLine(report.words)}`}</dd>
            </div>
            <div>
              <dt className="font-condensed text-[13px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
                {reportingWords.description}
              </dt>
              <dd className="text-[17px] whitespace-pre-line [overflow-wrap:anywhere]">
                {report.description}
              </dd>
            </div>
          </dl>
        </Panel>
        {report.hasPhoto ? (
          <FaultPhoto
            path={`/fault-reports/mine/${report.id}/photo`}
            alt={reportingWords.photoField}
            className="max-h-[200px] w-fit max-w-full rounded-[4px] border border-line object-contain"
          />
        ) : null}
        <SiteText muted size={15}>
          {reportingWords.behind}
        </SiteText>
      </SiteScreen>
    </>
  )
}

/**
 * "Scannen" for whoever reports and does not see the assets: the label of a
 * room or an asset, which the server names by the room and the building, and
 * the way on to report there. Every other answer is the one of every scan.
 */
export function ReporterScanScreen() {
  const [scanned, setScanned] = useState<string | null>(null)
  const [foreign, setForeign] = useState(false)

  const again = () => {
    setScanned(null)
    setForeign(false)
  }

  if (foreign) {
    return <ScanMessage message={labelWords.foreign} look={scanLooks.foreign} onAgain={again} />
  }

  if (scanned !== null) {
    return <ReporterScanned code={scanned} onAgain={again} />
  }

  return (
    <ScanCamera
      onCode={(read) => {
        const code = labelCodeFromScan(read)

        if (code === null) {
          setForeign(true)
        } else {
          setScanned(code)
        }
      }}
    />
  )
}

/** What a scan says to somebody who reports, in the words of every scan. */
const labelWords = {
  blocked: {
    title: 'Etikett gesperrt',
    text: 'Dieses Etikett ist gesperrt und öffnet nichts mehr.',
  },
  unknown: {
    title: 'Kein Etikett dieses Betreibers',
    text: 'Dieses Etikett gehört nicht zu diesem Betreiber. Es öffnet hier nichts.',
  },
  outside: {
    title: 'Außerhalb Ihrer Bereiche',
    text: 'Was dieses Etikett öffnet, liegt nicht in Ihren Bereichen. Wählen Sie den Ort aus der Liste.',
  },
  unassigned: {
    title: 'Noch keinem Ort zugeordnet',
    text: 'Dieses Etikett hängt noch an keinem Raum und keiner Anlage. Wählen Sie den Ort aus der Liste.',
  },
  offline: { title: reportingWords.offline, text: reportingWords.offlineText },
  foreign: { title: 'Kein Etikett', text: 'Der Code gehört zu keinem Etikett dieser Anwendung.' },
} as const

function ReporterScanned({
  code,
  onAgain,
}: {
  readonly code: string
  readonly onAgain: () => void
}) {
  const answer = useQuery(labelQuery(code))
  const navigate = useNavigate()

  if (answer.data === undefined) {
    if (answer.fetchStatus === 'paused' || answer.isError) {
      return <ScanMessage message={labelWords.offline} look={scanLooks.notHere} onAgain={onAgain} />
    }

    return (
      <>
        <SiteHeader title="Scannen" sub="Etikett an Raum oder Anlage" />
        <SiteScreen>
          <SiteText muted>Einen Moment, das Etikett wird gesucht.</SiteText>
        </SiteScreen>
      </>
    )
  }

  const read = answer.data

  if (read.standing !== 'open') {
    return (
      <ScanMessage
        message={labelWords[read.standing]}
        look={scanLooks[read.standing]}
        onAgain={onAgain}
      />
    )
  }

  return (
    <>
      <SiteHeader title="Scannen" sub="Etikett an Raum oder Anlage" />
      <SiteScreen>
        <Panel title="Erkannt">
          <div className="text-[18px] font-bold [overflow-wrap:anywhere]">
            {read.words.room ?? read.words.building}
          </div>
          <div className="text-[15px] text-ink-muted">
            {read.words.room === null
              ? read.words.property
              : `${read.words.property}, ${read.words.building}`}
          </div>
        </Panel>
        <Button
          tone="primary"
          wide
          height={60}
          icon={MessageSquareWarning}
          onClick={() => {
            void navigate({ to: reportingPlaces.report, search: { etikett: code } })
          }}
        >
          {reportingWords.report}
        </Button>
        <Button wide height={56} icon={ScanLine} onClick={onAgain}>
          Erneut scannen
        </Button>
      </SiteScreen>
    </>
  )
}

/**
 * "Störung melden" in the menu (#331), for every role that reports and sees
 * the places: the own reports and the way to a new one. A Melder starts there.
 */
export function ReportingMenuRow() {
  const reports = useRight('fault.report')
  const seesPlaces = useRight('location.read')

  if (!reports || !seesPlaces) {
    return null
  }

  return (
    <Link
      to={reportingPlaces.start}
      className="flex min-h-14 items-center gap-3 rounded-[6px] px-3.5 text-[17px] text-ink no-underline"
    >
      <MessageSquareWarning size={22} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
      <span className="grow">{reportingWords.report}</span>
    </Link>
  )
}
