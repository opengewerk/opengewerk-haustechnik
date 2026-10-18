import {
  type TravelKeep,
  type TravelPlace,
  travelFiles,
  travelSize,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { fileSize } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import { SiteScreen, SiteText, SiteTrouble, TopTitle } from '@opengewerk/platform-web/site'
import { maybeText, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { Check, Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { markForTheRoad, useTravelDocuments, useTravelKeep } from '../sync/travel.js'

/** What the screens of the road say, in the words of the boards (#348). */
export const siteTravelWords = {
  title: 'Unterlagen für unterwegs',
  over: 'Auf diesem Gerät',
  mark: 'Für unterwegs merken',
  marked: 'Für unterwegs gemerkt',
  forget: 'Vergessen',
  files: (count: number) => (count === 1 ? '1 Datei' : `${String(count)} Dateien`),
  offer: (files: string, size: string) =>
    `Holt ${files}, ${size}, auf dieses Gerät, damit sie ohne Netz aufgehen.`,
  kept: (files: string, size: string) =>
    `${files} auf diesem Gerät, ${size}. Sie gehen auch ohne Netz auf; eine neue Fassung kommt beim nächsten Abgleich.`,
  coming: 'Noch nicht alle auf dem Gerät. Sie kommen mit dem nächsten Abgleich.',
  noRoom: (needed: string, free: string) =>
    `Auf diesem Gerät ist nicht genug Platz: ${needed} gebraucht, ${free} frei.`,
  none: 'Noch ist nichts gemerkt. An einer Anlage oder einem Raum unter „Dokumente“ „Für unterwegs merken“ wählen.',
  asset: 'Anlage',
  room: 'Raum',
  gone: 'Nicht mehr auf diesem Gerät',
  room_: 'Platz',
  used: (size: string) => `Belegt ${size}`,
  quota: (size: string) => `von etwa ${size}`,
  quotaNote:
    'So viel gibt der Browser dieser Seite. Er hält die Dateien, solange OpenGewerk auf diesem Gerät angemeldet ist.',
  note: 'Neue Fassungen kommen beim nächsten Abgleich. Ein entferntes Dokument und eins außerhalb Ihrer Bereiche verschwindet dann vom Gerät, beim Abmelden alles.',
  onDevice: ' · auf dem Gerät',
} as const

/** The files a place wants and whether each lies on the device for the road. */
function usePlaceFiles(place: TravelPlace, keep: TravelKeep) {
  const documents = useTravelDocuments()

  return useMemo(() => {
    const wanted = travelFiles([place], documents)
    const size = travelSize(wanted)
    const there = new Set(keep.files)

    return {
      wanted,
      size,
      complete: wanted.every((file) => there.has(file.sha256)),
    }
  }, [place, documents, keep.files])
}

const gigabytes = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** The room a browser gives a page, in gigabytes once it is that much: "2,1 GB". */
function roomWords(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${gigabytes.format(bytes / 1_000_000_000)} GB` : fileSize(bytes)
}

function storage(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage
}

/**
 * "Für unterwegs merken" under the documents of an asset or a room (#348),
 * and after that what lies on the device and "Vergessen". The files come with
 * the round that follows, also later when the device has a network again.
 * Before that the browser is asked whether there is room for them; where it
 * says how much it gives the page and there is too little, nothing is marked.
 * It is asked as well to keep the files when it runs short of space.
 */
export function TravelControl({ place }: { readonly place: TravelPlace }) {
  const client = useSync()
  const keep = useTravelKeep()
  const { wanted, size, complete } = usePlaceFiles(place, keep)
  const marked = keep.places.some((each) => each.kind === place.kind && each.id === place.id)
  const [trouble, setTrouble] = useState<string | null>(null)
  const files = siteTravelWords.files(size.files)
  const bytes = fileSize(size.bytes)

  if (!marked && wanted.length === 0) {
    return null
  }

  async function mark() {
    setTrouble(null)

    const estimate = await storage()
      ?.estimate()
      .catch(() => undefined)

    if (
      estimate?.quota !== undefined &&
      estimate.usage !== undefined &&
      estimate.quota - estimate.usage < size.bytes
    ) {
      setTrouble(
        siteTravelWords.noRoom(bytes, fileSize(Math.max(0, estimate.quota - estimate.usage))),
      )

      return
    }

    void storage()
      ?.persist?.()
      .catch(() => false)
    await markForTheRoad(client, place, true)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {marked ? (
        <>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-done">
            <Check size={18} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
            {siteTravelWords.marked}
          </p>
          <SiteText muted size={15}>
            {complete ? siteTravelWords.kept(files, bytes) : siteTravelWords.coming}
          </SiteText>
          <Button
            wide
            height={52}
            onClick={() => {
              void markForTheRoad(client, place, false)
            }}
          >
            {siteTravelWords.forget}
          </Button>
        </>
      ) : (
        <>
          <Button
            wide
            height={52}
            icon={Download}
            onClick={() => {
              void mark()
            }}
          >
            {siteTravelWords.mark}
          </Button>
          <SiteText muted size={15}>
            {siteTravelWords.offer(files, bytes)}
          </SiteText>
        </>
      )}
      {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
    </div>
  )
}

/** Whether the newest version of a document lies on the device for the road. */
export function useOnDevice(): (sha256: string) => boolean {
  const keep = useTravelKeep()

  return useMemo(() => {
    const there = new Set(keep.files)

    return (sha256: string) => there.has(sha256)
  }, [keep.files])
}

/** A marked place in the list: what it is called and where it is, as the device holds it. */
function usePlaceWords(place: TravelPlace): { title: string; where: string } | null {
  const assets = useRecords('assets')
  const rooms = useRecords('rooms')
  const buildings = useRecords('buildings')
  const properties = useRecords('properties')
  const byId = (records: typeof assets, id: unknown) =>
    records.find((record) => record['id'] === id) ?? null
  const titled = (record: (typeof assets)[number]) =>
    [maybeText(record, 'number'), text(record, 'name')].filter(Boolean).join(' ')

  if (place.kind === 'asset') {
    const asset = byId(assets, place.id)

    if (asset === null) {
      return null
    }

    const room = byId(rooms, asset['roomId'])
    const building = byId(buildings, asset['buildingId'])

    return {
      title: titled(asset),
      where: [
        siteTravelWords.asset,
        [building ? text(building, 'name') : null, room ? titled(room) : null]
          .filter(Boolean)
          .join(', '),
      ]
        .filter(Boolean)
        .join(' · '),
    }
  }

  const room = byId(rooms, place.id)

  if (room === null) {
    return null
  }

  const building = byId(buildings, room['buildingId'])
  const property = building ? byId(properties, building['propertyId']) : null

  return {
    title: titled(room),
    where: [
      siteTravelWords.room,
      [property ? text(property, 'name') : null, building ? text(building, 'name') : null]
        .filter(Boolean)
        .join(', '),
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

function KeptPlace({ place, keep }: { readonly place: TravelPlace; readonly keep: TravelKeep }) {
  const client = useSync()
  const words = usePlaceWords(place)
  const { size, complete } = usePlaceFiles(place, keep)

  return (
    <li className="flex items-start gap-2.5 border-b border-row py-3">
      <div className="min-w-0 grow">
        <p className="text-[17px] font-semibold [overflow-wrap:anywhere]">
          {words?.title ?? siteTravelWords.gone}
        </p>
        {words ? <p className="mt-0.5 text-[15px] text-ink-muted">{words.where}</p> : null}
        <p className="mt-0.5 text-[15px] text-ink-muted">
          {siteTravelWords.files(size.files)}, {fileSize(size.bytes)}
        </p>
        {complete ? null : (
          <p className="mt-1 text-[15px] text-waiting">{siteTravelWords.coming}</p>
        )}
      </div>
      <Button
        height={44}
        onClick={() => {
          void markForTheRoad(client, place, false)
        }}
      >
        {siteTravelWords.forget}
      </Button>
    </li>
  )
}

/** "Unterlagen für unterwegs" from the menu (#348): what this device keeps, and the room it takes. */
export function TravelScreen() {
  const keep = useTravelKeep()
  const documents = useTravelDocuments()
  const [quota, setQuota] = useState<number | null>(null)
  const used = useMemo(() => {
    const there = new Set(keep.files)

    return travelSize(travelFiles(keep.places, documents).filter((file) => there.has(file.sha256)))
      .bytes
  }, [keep, documents])

  useEffect(() => {
    let live = true

    void storage()
      ?.estimate()
      .then((estimate) => {
        if (live && estimate.quota !== undefined) {
          setQuota(estimate.quota)
        }
      })
      .catch(() => undefined)

    return () => {
      live = false
    }
  }, [])

  return (
    <SiteScreen gap={12}>
      <TopTitle over={siteTravelWords.over} title={siteTravelWords.title} />
      {keep.places.length === 0 ? (
        <SiteText muted>{siteTravelWords.none}</SiteText>
      ) : (
        <Panel>
          <ul aria-label={siteTravelWords.title} className="flex flex-col">
            {keep.places.map((place) => (
              <KeptPlace key={`${place.kind}:${place.id}`} place={place} keep={keep} />
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={siteTravelWords.room_}>
        <div className="flex flex-col gap-1.5">
          <p className="flex items-baseline gap-2">
            <span className="grow text-[17px] font-semibold">
              {siteTravelWords.used(fileSize(used))}
            </span>
            {quota === null ? null : (
              <span className="text-[15px] text-ink-muted">
                {siteTravelWords.quota(roomWords(quota))}
              </span>
            )}
          </p>
          <SiteText muted size={15}>
            {siteTravelWords.quotaNote}
          </SiteText>
        </div>
      </Panel>
      <SiteText muted size={15}>
        {siteTravelWords.note}
      </SiteText>
    </SiteScreen>
  )
}

/** The row of the menu that leads to the list, for whoever looks at documents, with what is kept. */
export function TravelMenuRow() {
  const reads = useRight('document.read')
  const keep = useTravelKeep()
  const documents = useTravelDocuments()

  if (!reads) {
    return null
  }

  const assets = keep.places.filter((place) => place.kind === 'asset').length
  const rooms = keep.places.length - assets
  const there = new Set(keep.files)
  const bytes = travelSize(
    travelFiles(keep.places, documents).filter((file) => there.has(file.sha256)),
  ).bytes
  const summary = [
    assets === 0 ? null : assets === 1 ? '1 Anlage' : `${String(assets)} Anlagen`,
    rooms === 0 ? null : rooms === 1 ? '1 Raum' : `${String(rooms)} Räume`,
    keep.places.length === 0 ? null : fileSize(bytes),
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Link
      to="/unterwegs"
      className="flex min-h-14 items-center gap-3 rounded-[6px] px-3.5 text-[17px] text-ink no-underline"
    >
      <Download size={22} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
      <span className="grow">
        {siteTravelWords.title}
        {summary === '' ? null : (
          <span className="block text-[14px] text-ink-muted">{summary}</span>
        )}
      </span>
    </Link>
  )
}
