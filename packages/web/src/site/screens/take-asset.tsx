import {
  type AssetKind,
  assetProblems,
  assetValueProblems,
  type Catalogue,
  isGeneralKind,
  jsonText,
  labelCodeFromScan,
  meterMediumLabel,
  meterProblems,
  meterUnitSymbol,
  possibleDuplicates,
  type RecordState,
  sameWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, IconButton, SelectField } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteLabel,
  SiteLink,
  SiteScreen,
  SiteText,
  SiteTrouble,
  useCodeReading,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Camera, Check, Pencil, QrCode, ScanLine, TriangleAlert } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import {
  generalKindNote,
  kindChoices,
  type KindField,
  kindFields,
  unitOf,
  valuesOf,
  yearOf,
} from '../../app/asset-values.js'
import { fileDocument } from '../../app/documents.js'
import { byNumber, titleOfRoom } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import {
  assetTitle,
  CameraFrame,
  CameraPicture,
  GoButton,
  NotOffered,
  NotOnDevice,
} from '../kit.js'
import { sitePlaces, stockTaking } from '../places.js'

export const takeAssetWords = {
  mayNot: 'Anlagen aufnehmen gehört nicht zu den Rechten dieses Zugangs.',
  noCatalogue:
    'Dieses Gerät hat den Katalog noch nicht geholt. Aus ihm kommen die Anlagenarten; mit Verbindung holt es ihn von selbst.',
  noRoom: 'Kein Raum',
  roomMissing: 'Fehlt der Raum? Er lässt sich auf der Seite seines Geschosses aufnehmen.',
  noValue: 'Keine Angabe',
  check: 'Bitte prüfen Sie die markierten Felder.',
  saved: 'Auf dem Gerät gesichert. Die Nummer vergibt der Server beim Abgleich.',
  checkedHere:
    'Geprüft gegen die Anlagen auf diesem Gerät. Der Server prüft beim Abgleich noch einmal.',
  sameOne: 'Ist es dieselbe Anlage, öffnen Sie diese statt eine zweite anzulegen.',
  photoField: 'Foto des Typenschilds',
  photoTaken: 'Aufgenommenes Typenschild',
  photoTitle: 'Typenschild',
  photoNotFiled:
    'Die Anlage ist angelegt, das Foto ließ sich nicht ablegen. Auf ihrer Seite lässt es sich noch einmal aufnehmen.',
  openAsset: 'Anlage öffnen',
  giveLabel: 'Etikett zuordnen',
  holdThePlate: 'Halten Sie den Strichcode des Typenschilds in den Rahmen.',
} as const

const serialCameraWords = {
  noReader: 'Dieses Gerät liest keine Strichcodes. Die Seriennummer lässt sich von Hand eintragen.',
  noCamera:
    'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Die Seriennummer lässt sich von Hand eintragen.',
}

interface Typed {
  readonly kind: string
  readonly roomId: string
  readonly name: string
  readonly manufacturer: string
  readonly model: string
  readonly serialNumber: string
  readonly yearBuilt: string
  readonly meterNumber: string
  readonly meterUnit: string
  readonly values: Readonly<Record<string, string>>
}

/**
 * The tab "Aufnehmen" one step in: an asset taken in on site, also without a
 * network (#99, boards "Anlage aufnehmen, ohne Netz", "Seriennummer lesen"
 * and "Dublette", 4.2 of the concept). The address names the building, or the
 * room and with it the building.
 *
 * The asset goes into the outbox, without a number until the server has seen
 * it. The rules are those of `domain`, asked before anything is queued, and
 * so is the question whether it is there already: against the assets this
 * device holds, while the server asks again against all of them when the
 * device exchanges (2.7). What the person saw and passed goes with the asset
 * (`distinctFrom`), so that the server does not ask about it a second time.
 *
 * The serial number is read from the bar code of the type plate where the
 * camera can, and typed where it cannot. The camera opens with the tap on
 * its button and never by itself.
 *
 * The photo of the type plate is filed at the new asset. Where it is not,
 * the asset stands all the same: the screen says so in place of the form,
 * with the reason where there is one, and leads on. The form is gone by
 * then, so that nobody takes the same asset in a second time.
 */
export function TakeAssetScreen() {
  const params = useParams({ strict: false }) as { buildingId?: string; roomId?: string }
  const room = useRecord('rooms', params.roomId)
  const buildingId = params.buildingId ?? maybeText(room, 'buildingId') ?? undefined
  const building = useRecord('buildings', buildingId)
  const property = useRecord('properties', maybeText(building, 'propertyId') ?? undefined)
  const catalogue = useCatalogue()
  const records = useRight('asset.record')
  const toStart = { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }

  if (!building || (params.roomId !== undefined && !room)) {
    return (
      <NotOnDevice
        what={params.roomId === undefined ? 'Dieses Gebäude' : 'Diesen Raum'}
        back={toStart}
      />
    )
  }

  const back = room
    ? { to: sitePlaces.room(String(room['id'])), label: 'Zurück zum Raum' }
    : { to: sitePlaces.building(String(building['id'])), label: 'Zurück zum Gebäude' }

  if (!records) {
    return (
      <NotOffered title="Anlage aufnehmen" back={back}>
        {takeAssetWords.mayNot}
      </NotOffered>
    )
  }

  if (!catalogue) {
    return (
      <NotOffered title="Anlage aufnehmen" back={back}>
        {takeAssetWords.noCatalogue}
      </NotOffered>
    )
  }

  return (
    <TakeAssetForm
      key={`${String(building['id'])} ${params.roomId ?? ''}`}
      catalogue={catalogue}
      building={building}
      property={property}
      startsIn={params.roomId ?? ''}
      back={back}
    />
  )
}

function TakeAssetForm({
  catalogue,
  building,
  property,
  startsIn,
  back,
}: {
  readonly catalogue: Catalogue
  readonly building: RecordState
  readonly property: RecordState | null
  /** The room the address named, or none. */
  readonly startsIn: string
  readonly back: { readonly to: string; readonly label: string }
}) {
  const client = useSync()
  const navigate = useNavigate()
  const buildingId = String(building['id'])
  const rooms = useRecords('rooms')
    .filter((each) => each['buildingId'] === buildingId)
    .sort(byNumber)
  const assets = useRecords('assets')
  const allRooms = useRecords('rooms')
  const buildings = useRecords('buildings')
  const photoField = useRef<HTMLInputElement>(null)

  const [typed, setTyped] = useState<Typed>({
    kind: '',
    roomId: startsIn,
    name: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    yearBuilt: '',
    meterNumber: '',
    meterUnit: '',
    values: {},
  })
  const [photo, setPhoto] = useState<File | null>(null)
  const [reading, setReading] = useState(false)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // The asset that stands without its photo: where the person was going,
  // and why, where a sentence says so.
  const [unfiled, setUnfiled] = useState<{
    readonly assetId: string
    readonly next: 'page' | 'label'
    readonly reason: string | null
  } | null>(null)

  const set = (values: Partial<Typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }
  const kind: AssetKind | null =
    typed.kind === '' ? null : (catalogue.assetKind(typed.kind, today())?.definition ?? null)
  // Asked on every stroke: the assets of a device are few, and the card has
  // to be there before somebody presses "Anlegen".
  const duplicates = possibleDuplicates({ serialNumber: typed.serialNumber }, assets)
  const first = duplicates[0]

  /** Where an asset the device holds stands, "Sporthalle Süd, E.03 Geräteraum". */
  const whereIs = (asset: RecordState) => {
    const itsRoom = allRooms.find((each) => each['id'] === asset['roomId']) ?? null
    const itsBuilding = buildings.find((each) => each['id'] === asset['buildingId']) ?? null

    return [maybeText(itsBuilding, 'name'), itsRoom ? titleOfRoom(itsRoom) : null]
      .filter((part) => part !== null && part !== '')
      .join(', ')
  }

  if (reading) {
    return (
      <SerialReader
        name={typed.name}
        onTake={(serialNumber) => {
          set({ serialNumber })
          setReading(false)
        }}
        onClose={() => {
          setReading(false)
        }}
      />
    )
  }

  async function save(then: 'page' | 'label', event?: FormEvent) {
    event?.preventDefault()
    setTrouble(null)

    const wanted = {
      kind: typed.kind === '' ? null : typed.kind,
      name: typed.name,
      manufacturer: typed.manufacturer,
      model: typed.model,
      serialNumber: typed.serialNumber,
      yearBuilt: yearOf(typed.yearBuilt),
      ...(kind
        ? {
            values: valuesOf(kind, typed.values),
            meterNumber:
              kind.meter === null || typed.meterNumber.trim() === '' ? null : typed.meterNumber,
            meterUnit: kind.meter === null || typed.meterUnit === '' ? null : typed.meterUnit,
          }
        : {}),
    }
    const wrong = {
      ...assetProblems(wanted),
      ...(kind && wanted.values ? assetValueProblems(kind, wanted.values) : {}),
      ...(kind ? meterProblems(kind, wanted) : {}),
    }

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(takeAssetWords.check)

      return
    }

    setWorking(true)

    try {
      const { values, ...plain } = wanted
      const made = await client.create('assets', {
        buildingId,
        roomId: typed.roomId === '' ? null : typed.roomId,
        // An empty field is no value, as the server stores it.
        ...Object.fromEntries(
          Object.entries(plain).map(([field, value]) => [
            field,
            typeof value === 'string' && value.trim() === '' ? null : value,
          ]),
        ),
        ...(values === undefined ? {} : { values: jsonText(values) }),
        // What the person saw on this device and passed: the server asks
        // about every other asset with the same number.
        distinctFrom: jsonText(duplicates.map(({ asset }) => String(asset['id']))),
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      const propertyId = maybeText(building, 'propertyId')

      if (photo && propertyId !== null) {
        // A sentence says why the photo is not filed; a filing that threw says nothing.
        const missing = await fileDocument(client, { propertyId, assetId: made.id }, photo, {
          title: takeAssetWords.photoTitle,
        }).then(
          (sentence) => (sentence === null ? null : { reason: sentence }),
          () => ({ reason: null }),
        )

        if (missing !== null) {
          // The asset stands: the screen says what is missing in place of the
          // form, and its page offers the photo again.
          setUnfiled({ assetId: made.id, next: then, ...missing })

          return
        }
      }

      void navigate({
        to: then === 'label' ? stockTaking.label(made.id) : sitePlaces.asset(made.id),
      })
    } finally {
      setWorking(false)
    }
  }

  const sub = [maybeText(property, 'name'), text(building, 'name')].filter(Boolean).join(', ')

  if (unfiled) {
    return (
      <>
        <SiteHeader title="Anlage aufnehmen" sub={sub} back={back} />
        <SiteScreen>
          <SiteTrouble>{takeAssetWords.photoNotFiled}</SiteTrouble>
          {unfiled.reason === null ? null : <SiteText>{unfiled.reason}</SiteText>}
        </SiteScreen>
        <SiteActionBar stacked>
          {unfiled.next === 'label' ? (
            <GoButton to={stockTaking.label(unfiled.assetId)} icon={QrCode} tone="primary">
              {takeAssetWords.giveLabel}
            </GoButton>
          ) : null}
          <GoButton
            to={sitePlaces.asset(unfiled.assetId)}
            tone={unfiled.next === 'label' ? 'secondary' : 'primary'}
          >
            {takeAssetWords.openAsset}
          </GoButton>
        </SiteActionBar>
      </>
    )
  }

  const general = kind !== null && isGeneralKind(typed.kind)
  const ownFields = kind ? kindFields(kind) : []

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void save('page', event)
      }}
    >
      <SiteHeader title="Anlage aufnehmen" sub={sub} back={back} />
      <SiteScreen>
        <SelectField
          label="Anlagenart"
          options={[{ value: '', label: 'Bitte wählen' }, ...kindChoices(catalogue)]}
          value={typed.kind}
          {...(problems['kind'] ? { problem: problems['kind'] } : {})}
          onChange={(value) => {
            set({ kind: value, values: {}, meterNumber: '', meterUnit: '' })
          }}
        />
        {general ? (
          <SiteText muted size={15}>
            {generalKindNote}
          </SiteText>
        ) : null}
        <SelectField
          label="Raum"
          options={[
            { value: '', label: takeAssetWords.noRoom },
            ...rooms.map((each) => ({ value: String(each['id']), label: titleOfRoom(each) })),
          ]}
          value={typed.roomId}
          hint={takeAssetWords.roomMissing}
          onChange={(value) => {
            set({ roomId: value })
          }}
        />
        <Field
          label="Bezeichnung"
          value={typed.name}
          {...(problems['name'] ? { problem: problems['name'] } : {})}
          onChange={(event) => {
            set({ name: event.target.value })
          }}
        />
        <Field
          label="Hersteller"
          value={typed.manufacturer}
          {...(problems['manufacturer'] ? { problem: problems['manufacturer'] } : {})}
          onChange={(event) => {
            set({ manufacturer: event.target.value })
          }}
        />
        <Field
          label="Typ"
          value={typed.model}
          {...(problems['model'] ? { problem: problems['model'] } : {})}
          onChange={(event) => {
            set({ model: event.target.value })
          }}
        />
        {/* The camera stands beside the field, level with it, as the board draws it. */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 grow">
            <Field
              label="Seriennummer"
              value={typed.serialNumber}
              {...(problems['serialNumber']
                ? { problem: problems['serialNumber'] }
                : first
                  ? {
                      problem: `${sameWords(first.same)} wie ${assetTitle(first.asset)}.`,
                    }
                  : {})}
              onChange={(event) => {
                set({ serialNumber: event.target.value })
              }}
            />
          </div>
          <IconButton
            label="Seriennummer mit der Kamera lesen"
            tone="secondary"
            className="mt-6 size-14"
            onClick={() => {
              setReading(true)
            }}
          >
            <ScanLine size={22} strokeWidth={2.1} aria-hidden="true" />
          </IconButton>
        </div>
        {first ? (
          <section
            aria-label="Mögliche Dublette"
            className="rounded-[6px] border border-conflict-edge bg-conflict-fill p-3.5"
          >
            <p className="flex gap-2.5 text-[17px] leading-[1.35] font-semibold text-conflict">
              <TriangleAlert size={22} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
              <span>{`Diese Seriennummer trägt schon ${assetTitle(first.asset)}.`}</span>
            </p>
            <p className="mt-1.5 text-[15px] leading-[1.4] text-conflict-ink">
              {[whereIs(first.asset), takeAssetWords.sameOne].filter(Boolean).join('. ')}
            </p>
            {duplicates.length === 1 ? null : (
              <ul aria-label="Anlagen mit dieser Seriennummer" className="mt-2 flex flex-col gap-1">
                {duplicates.map(({ asset }) => (
                  <li key={String(asset['id'])} className="text-[16px]">
                    <SiteLink to={sitePlaces.asset(String(asset['id']))}>
                      {`${assetTitle(asset)} öffnen`}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {duplicates.length === 1 ? (
                <Button
                  tone="dark"
                  wide
                  height={52}
                  onClick={() => {
                    void navigate({ to: sitePlaces.asset(String(first.asset['id'])) })
                  }}
                >
                  Vorhandene Anlage öffnen
                </Button>
              ) : null}
              <Button
                wide
                height={52}
                disabled={working}
                onClick={() => {
                  void save('page')
                }}
              >
                Trotzdem anlegen
              </Button>
            </div>
          </section>
        ) : null}
        {first ? (
          <SiteText muted size={15}>
            {takeAssetWords.checkedHere}
          </SiteText>
        ) : null}
        <Field
          label="Baujahr"
          inputMode="numeric"
          numeric
          value={typed.yearBuilt}
          {...(problems['yearBuilt'] ? { problem: problems['yearBuilt'] } : {})}
          onChange={(event) => {
            set({ yearBuilt: event.target.value })
          }}
        />
        <div className="flex flex-col gap-1.5">
          <SiteLabel>Typenschild</SiteLabel>
          <input
            ref={photoField}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label={takeAssetWords.photoField}
            onChange={(event) => {
              setPhoto(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
          <div className="flex items-center gap-2.5">
            <PhotoThumb photo={photo} />
            <Button
              wide
              height={52}
              icon={Camera}
              onClick={() => {
                photoField.current?.click()
              }}
            >
              {photo ? 'Anderes Foto' : 'Foto aufnehmen'}
            </Button>
          </div>
        </div>
        {kind && (ownFields.length > 0 || kind.meter !== null) ? (
          <>
            <SiteLabel>Angaben der Anlagenart</SiteLabel>
            {kind.meter === null ? null : (
              <>
                <Field
                  label="Zählernummer"
                  hint={`Misst ${meterMediumLabel[kind.meter.medium]}.`}
                  value={typed.meterNumber}
                  {...(problems['meterNumber'] ? { problem: problems['meterNumber'] } : {})}
                  onChange={(event) => {
                    set({ meterNumber: event.target.value })
                  }}
                />
                <SelectField
                  label="Einheit"
                  options={[
                    { value: '', label: takeAssetWords.noValue },
                    ...kind.meter.units.map((unit) => ({
                      value: unit,
                      label: meterUnitSymbol[unit],
                    })),
                  ]}
                  value={typed.meterUnit}
                  {...(problems['meterUnit'] ? { problem: problems['meterUnit'] } : {})}
                  onChange={(value) => {
                    set({ meterUnit: value })
                  }}
                />
              </>
            )}
            {ownFields.map((entry) => (
              <KindFieldInput
                key={entry.field.key}
                entry={entry}
                value={typed.values[entry.field.key] ?? ''}
                problem={problems[`values.${entry.field.key}`]}
                onChange={(value) => {
                  set({ values: { ...typed.values, [entry.field.key]: value } })
                }}
              />
            ))}
          </>
        ) : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      {first ? null : (
        <SiteActionBar stacked note={takeAssetWords.saved}>
          <Button
            tone="primary"
            wide
            height={60}
            icon={Check}
            disabled={working}
            onClick={() => {
              void save('page')
            }}
          >
            Anlegen
          </Button>
          <Button
            wide
            height={60}
            icon={QrCode}
            disabled={working}
            onClick={() => {
              void save('label')
            }}
          >
            Anlegen und Etikett zuordnen
          </Button>
        </SiteActionBar>
      )}
    </form>
  )
}

/** The size the photo is shown in, and how many points of the picture stand behind each of its pixels. */
const thumb = { width: 70, height: 52, density: 2 } as const

/**
 * The photo that was taken, small, beside the button; in words where a
 * browser draws none from a file, and until it has. It is drawn once at the
 * size it is shown in: the file never becomes an address of the page, and
 * the telephone holds no second copy of a large picture.
 */
function PhotoThumb({ photo }: { readonly photo: File | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState<File | null>(null)

  useEffect(() => {
    if (!photo || typeof createImageBitmap !== 'function') {
      return undefined
    }

    let gone = false

    void createImageBitmap(photo)
      .then((picture) => {
        const context = gone ? null : canvas.current?.getContext('2d')

        if (context) {
          cover(context, picture)
          setDrawn(photo)
        }

        picture.close()
      })
      .catch(() => undefined)

    return () => {
      gone = true
    }
  }, [photo])

  if (!photo) {
    return null
  }

  const pictured = drawn === photo

  return (
    <>
      <canvas
        ref={canvas}
        width={thumb.width * thumb.density}
        height={thumb.height * thumb.density}
        role="img"
        aria-label={takeAssetWords.photoTaken}
        hidden={!pictured}
        className="h-[52px] w-[70px] shrink-0 rounded-[4px] border border-line"
      />
      {!pictured && <span className="shrink-0 text-[15px] text-ink-muted">Foto aufgenommen</span>}
    </>
  )
}

/** Fills the canvas with a picture that keeps its shape, cut evenly at the edges it overhangs. */
function cover(context: CanvasRenderingContext2D, picture: ImageBitmap) {
  const { width, height } = context.canvas
  const scale = Math.max(width / picture.width, height / picture.height)
  const cutWidth = width / scale
  const cutHeight = height / scale

  context.clearRect(0, 0, width, height)
  context.drawImage(
    picture,
    (picture.width - cutWidth) / 2,
    (picture.height - cutHeight) / 2,
    cutWidth,
    cutHeight,
    0,
    0,
    width,
    height,
  )
}

/** One field of the kind: a figure with its unit, yes or no, a choice, a text or a day. */
function KindFieldInput({
  entry,
  value,
  problem,
  onChange,
}: {
  readonly entry: KindField
  readonly value: string
  readonly problem: string | undefined
  readonly onChange: (value: string) => void
}) {
  const { field } = entry
  const unit = unitOf(entry)

  if (field.kind === 'flag' || field.kind === 'choice') {
    return (
      <SelectField
        label={field.label}
        options={[
          { value: '', label: takeAssetWords.noValue },
          ...(field.kind === 'flag'
            ? [
                { value: 'true', label: 'Ja' },
                { value: 'false', label: 'Nein' },
              ]
            : field.options),
        ]}
        value={value}
        {...(problem ? { problem } : {})}
        onChange={onChange}
      />
    )
  }

  return (
    <Field
      label={field.label}
      type={field.kind === 'date' ? 'date' : 'text'}
      {...(field.kind === 'number' ? { inputMode: 'decimal' as const, numeric: true } : {})}
      {...(unit === undefined ? {} : { unit })}
      value={value}
      {...(problem ? { problem } : {})}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}

/**
 * The camera on the type plate, board "Seriennummer lesen": it reads the bar
 * code a plate carries beside its serial number and shows what it read, and
 * the person takes it or types the number after all. A label of this
 * application held in front of it is no serial number and is passed over.
 */
function SerialReader({
  name,
  onTake,
  onClose,
}: {
  readonly name: string
  readonly onTake: (serialNumber: string) => void
  readonly onClose: () => void
}) {
  const [read, setRead] = useState<string | null>(null)
  const { video, trouble } = useCodeReading(
    true,
    (code) => {
      const said = code.trim()

      if (said !== '' && labelCodeFromScan(said) === null) {
        setRead(said)
      }
    },
    serialCameraWords,
  )

  return (
    <>
      <SiteHeader title="Seriennummer lesen" {...(name.trim() === '' ? {} : { sub: name })} />
      <CameraFrame
        hint={
          trouble
            ? null
            : read === null
              ? takeAssetWords.holdThePlate
              : `Erkannt: ${read}. ${takeAssetWords.holdThePlate}`
        }
      >
        <CameraPicture video={video} trouble={trouble} shape="wide" />
        {read === null || trouble ? null : (
          <p
            role="status"
            className="absolute inset-x-4 bottom-4 rounded-[8px] bg-surface px-3.5 py-2.5 text-center font-condensed text-[24px] font-semibold tracking-[1.2px] text-ink [overflow-wrap:anywhere]"
          >
            {read}
          </p>
        )}
      </CameraFrame>
      <SiteActionBar>
        <Button wide height={60} icon={Pencil} onClick={onClose}>
          Von Hand
        </Button>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Check}
          disabled={read === null}
          onClick={() => {
            if (read !== null) {
              onTake(read)
            }
          }}
        >
          Übernehmen
        </Button>
      </SiteActionBar>
    </>
  )
}
