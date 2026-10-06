import { labelCodeFromScan, type RecordState } from '@opengewerk/haustechnik-domain'
import { Button } from '@opengewerk/platform-web'
import { SiteHeader, SiteScreen, SiteText, useCodeReading } from '@opengewerk/platform-web/site'
import { maybeText, text, useRecord } from '@opengewerk/platform-web/sync'
import {
  Ban,
  Info,
  type LucideIcon,
  Map as MapIcon,
  QrCode,
  ScanLine,
  Tag,
  WifiOff,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'

import {
  type LabelLookup,
  type LabelMessage,
  labelMessages,
  labelOpens,
  useLabelLookup,
} from '../../app/labels.js'
import { titleOfRoom } from '../../app/place-records.js'

/**
 * The tab "Scannen" (#98), the boards "Scannen" and "Etikett gesperrt, fremd,
 * außerhalb": the camera looks for the label of an asset or a room and says
 * what it found, also without a network when the device holds the label.
 *
 * Only the path of the address on the label counts, not its host, so a label
 * printed while the instance lived under another address is read here as
 * well. A label that opens nothing says so, and none of the sentences names
 * what it hangs on.
 *
 * The pages of an asset and of a room on site arrive with taking stock (#99).
 * Until then what was recognised is named from the rows of the device and
 * leads to its page in the office.
 */
export function SiteScanScreen() {
  const [scanned, setScanned] = useState<string | null>(null)
  const [foreign, setForeign] = useState(false)

  const again = () => {
    setScanned(null)
    setForeign(false)
  }

  if (foreign) {
    return <ScanMessage message={labelMessages.foreign} look={looks.foreign} onAgain={again} />
  }

  if (scanned !== null) {
    return <Scanned code={scanned} onAgain={again} />
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

const cameraWords = {
  noReader: 'Dieses Gerät liest keine QR-Codes. Ohne Kamera geht es über die Suche im Büro.',
  noCamera:
    'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Ohne Kamera geht es über die Suche im Büro.',
}

const holdIntoTheFrame =
  'Halten Sie das Etikett in den Rahmen. Ohne Kamera geht es über die Suche im Büro.'

/**
 * The picture of the camera, `camera_view()` of the board: dark, with what is
 * laid over it, and under it the sentence that says what to do.
 */
function CameraFrame({
  hint = true,
  children,
}: {
  /** Left out while the picture itself says why there is none. */
  readonly hint?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 pb-3.5">
      <div className="relative h-[min(560px,calc(100dvh-240px))] min-h-[340px] overflow-hidden bg-camera text-camera-ink">
        {children}
      </div>
      {hint ? (
        <p className="px-4 text-[15px] leading-[1.45] text-ink-muted">{holdIntoTheFrame}</p>
      ) : null}
    </div>
  )
}

/** The camera while it looks for a label: the square for the QR code and the sentence under it. */
function ScanCamera({ onCode }: { readonly onCode: (read: string) => void }) {
  const { video, trouble } = useCodeReading(true, onCode, cameraWords)

  return (
    <>
      <SiteHeader title="Scannen" sub="Etikett an Anlage oder Raum" />
      <CameraFrame hint={trouble === null}>
        <video
          ref={video}
          muted
          playsInline
          aria-label="Bild der Kamera"
          className="absolute inset-0 size-full object-cover"
        />
        {trouble ? (
          <p
            role="alert"
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-7 text-center text-[16px] leading-[1.45]"
          >
            {trouble}
          </p>
        ) : (
          <div
            aria-hidden="true"
            className="absolute top-[46%] left-1/2 aspect-square w-[min(220px,60%)] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border-[3px] border-camera-ink shadow-[0_0_0_2000px_rgb(0_0_0/0.35)]"
          />
        )}
      </CameraFrame>
    </>
  )
}

/** A code of a label: what it opens, or why it opens nothing. */
function Scanned({ code, onAgain }: { readonly code: string; readonly onAgain: () => void }) {
  const lookup = useLabelLookup(code)

  if (lookup.state === 'asset' || lookup.state === 'room') {
    return <Recognised lookup={lookup} onAgain={onAgain} />
  }

  if (lookup.state === 'waiting') {
    return (
      <>
        <SiteHeader title="Scannen" sub="Etikett an Anlage oder Raum" />
        <SiteScreen>
          <SiteText muted>Einen Moment, das Etikett wird gesucht.</SiteText>
        </SiteScreen>
      </>
    )
  }

  return (
    <ScanMessage
      message={labelMessages[lookup.state]}
      look={looks[lookup.state]}
      onAgain={onAgain}
    />
  )
}

/** "E.14 Heizraum" of a room, with its building before it where the device holds that. */
function placeWords(building: RecordState | null, room: RecordState | null): string {
  return [maybeText(building, 'name'), room ? titleOfRoom(room) : null]
    .filter((part) => part !== null && part !== '')
    .join(', ')
}

/**
 * "Erkannt", the card over the picture of the camera on the board "Scannen":
 * the number and the name of the asset, or the room, and where it is, read
 * from the device, so that it stands without a network. It leads to the page
 * in the office until the pages on site are there (#99).
 */
function Recognised({
  lookup,
  onAgain,
}: {
  readonly lookup: Extract<LabelLookup, { state: 'asset' | 'room' }>
  readonly onAgain: () => void
}) {
  const asset = useRecord('assets', lookup.state === 'asset' ? lookup.assetId : undefined)
  const room = useRecord(
    'rooms',
    lookup.state === 'room' ? lookup.roomId : (maybeText(asset, 'roomId') ?? undefined),
  )
  const building = useRecord(
    'buildings',
    maybeText(asset, 'buildingId') ?? maybeText(room, 'buildingId') ?? undefined,
  )
  const floor = useRecord('floors', maybeText(room, 'floorId') ?? undefined)

  const opens =
    lookup.state === 'asset'
      ? {
          href: labelOpens.asset(lookup.assetId),
          name: asset
            ? [maybeText(asset, 'number'), text(asset, 'name')].filter(Boolean).join(' ')
            : 'Eine Anlage',
          where: placeWords(building, room),
          what: 'öffnet die Akte im Büro',
        }
      : {
          href: labelOpens.room(lookup.roomId),
          name: room ? titleOfRoom(room) : 'Ein Raum',
          where: [maybeText(building, 'name'), maybeText(floor, 'name')]
            .filter((part) => part !== null && part !== '')
            .join(', '),
          what: 'öffnet den Raum im Büro',
        }

  return (
    <>
      <SiteHeader title="Scannen" sub="Etikett an Anlage oder Raum" />
      <CameraFrame>
        <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2.5">
          <a
            href={opens.href}
            className="block rounded-[8px] bg-surface px-3.5 py-3 text-ink shadow-[0_4px_16px_rgb(0_0_0/0.3)]"
          >
            <span className="block font-condensed text-[13px] font-semibold tracking-[1px] text-ink-faint uppercase">
              Erkannt
            </span>
            <span className="block text-[18px] font-bold [overflow-wrap:anywhere]">
              {opens.name}
            </span>
            <span className="block text-[15px] text-ink-muted [overflow-wrap:anywhere]">
              {[opens.where, opens.what].filter((part) => part !== '').join(' · ')}
            </span>
          </a>
          <Button wide height={56} icon={ScanLine} onClick={onAgain}>
            Erneut scannen
          </Button>
        </div>
      </CameraFrame>
    </>
  )
}

const tones = {
  neutral: { box: 'border-line bg-surface', title: 'text-ink' },
  conflict: { box: 'border-conflict-edge bg-conflict-fill', title: 'text-conflict' },
  waiting: { box: 'border-waiting-edge bg-waiting-fill', title: 'text-waiting' },
} as const

interface Look {
  readonly icon: LucideIcon
  readonly tone: keyof typeof tones
}

/** How each message is drawn, `message()` of the board. */
const looks = {
  blocked: { icon: Ban, tone: 'conflict' },
  unknown: { icon: QrCode, tone: 'neutral' },
  outside: { icon: MapIcon, tone: 'waiting' },
  unassigned: { icon: Tag, tone: 'neutral' },
  notHere: { icon: WifiOff, tone: 'neutral' },
  foreign: { icon: Info, tone: 'neutral' },
} as const satisfies Readonly<Record<string, Look>>

/** What a code opens not, as the board "Etikett gesperrt, fremd, außerhalb" draws it. */
function ScanMessage({
  message,
  look,
  onAgain,
}: {
  readonly message: LabelMessage
  readonly look: Look
  readonly onAgain: () => void
}) {
  const Icon = look.icon

  return (
    <>
      <SiteHeader title="Scannen" sub="Etikett an Anlage oder Raum" />
      <SiteScreen>
        <section role="status" className={`rounded-[8px] border p-3.5 ${tones[look.tone].box}`}>
          <h2
            className={`flex items-center gap-2.5 text-[18px] font-bold ${tones[look.tone].title}`}
          >
            <Icon size={22} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            {message.title}
          </h2>
          <p className="mt-1.5 text-[16px] leading-[1.45] text-ink">{message.text}</p>
        </section>
        <Button wide height={56} icon={ScanLine} onClick={onAgain}>
          Erneut scannen
        </Button>
      </SiteScreen>
    </>
  )
}
