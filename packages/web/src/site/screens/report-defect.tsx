import { defectLimits, defectProblems } from '@opengewerk/haustechnik-domain'
import { Button, Panel, TextArea } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  useRecord,
  useRelated,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Camera, Check, DoorOpen, Zap } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'

import { beginActivity } from '../../app/answers.js'
import { fileDocument } from '../../app/documents.js'
import { titleOfRoom } from '../../app/place-records.js'
import { NotOffered, NotOnDevice } from '../kit.js'
import { siteForms, sitePlaces } from '../places.js'

export const reportDefectWords = {
  sub: 'auch ohne Netz',
  mayNot: 'Mängel melden gehört nicht zu den Rechten dieses Zugangs.',
  fixed:
    'Dieser Vorgang ist unterschrieben oder abgeschlossen. Ein Mangel wird jetzt an der Anlage oder am Raum gemeldet.',
  where: 'Woran',
  remark: 'Bemerkung',
  takePhoto: 'Foto aufnehmen',
  photoField: 'Foto des Mangels',
  classLater: 'Klasse und Frist setzt, wer Mängel führt.',
  check: 'Bitte prüfen Sie die markierten Felder.',
  saved: 'Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.',
  photoNotFiled: 'Der Mangel ist gemeldet, ein Foto ließ sich nicht ablegen.',
} as const

/**
 * "Mangel melden" on site, `mangel_melden()` of the boards (4.6 of the
 * concept, #116): at the asset or the room whose page leads here, with a
 * remark and photos, also without a network. The defect goes through the
 * outbox with the day it was found, the photos after it as documents at the
 * defect; both wait on the device until the next exchange. A class and a
 * deadline come from whoever keeps defects, in the office.
 *
 * Reported from the result of an activity (#108), it is found in that
 * activity, at its asset or its room, on the day it was performed, and it
 * stands on the page that is signed.
 */
export function ReportDefectScreen() {
  const params = useParams({ strict: false }) as {
    assetId?: string
    roomId?: string
    activityId?: string
  }
  const client = useSync()
  const navigate = useNavigate()
  const reports = useRight('defect.report')
  const activity = useRecord('activities', params.activityId)
  // A defect is reported in an activity only while the work on it goes on: in
  // one signed here or closed it would change the page that was signed (#108).
  const signedHere = useRelated('activity_signatures', 'activityId', params.activityId ?? '').some(
    (signature) => signature['role'] === 'signer',
  )
  const fixed =
    params.activityId !== undefined &&
    (signedHere || !['open', 'started'].includes(maybeText(activity, 'status') ?? ''))
  const assetId = params.assetId ?? maybeText(activity, 'assetId') ?? undefined
  const roomId =
    params.roomId ??
    (assetId === undefined ? (maybeText(activity, 'roomId') ?? undefined) : undefined)
  const asset = useRecord('assets', assetId)
  const room = useRecord('rooms', roomId ?? maybeText(asset, 'roomId') ?? undefined)
  const building = useRecord(
    'buildings',
    maybeText(asset, 'buildingId') ?? maybeText(room, 'buildingId') ?? undefined,
  )
  const propertyId =
    maybeText(asset, 'propertyId') ??
    maybeText(room, 'propertyId') ??
    maybeText(building, 'propertyId')
  const picker = useRef<HTMLInputElement>(null)
  const [remark, setRemark] = useState('')
  const [photos, setPhotos] = useState<readonly File[]>([])
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const at = assetId !== undefined ? asset : room

  if (!at || propertyId === null) {
    return (
      <NotOnDevice
        what={assetId !== undefined ? 'Diese Anlage' : 'Dieser Raum'}
        back={{ to: '/scannen', label: 'Zurück zum Scannen' }}
      />
    )
  }

  const back =
    params.activityId !== undefined
      ? { to: siteForms.result(params.activityId), label: 'Zurück zum Ergebnis' }
      : assetId !== undefined
        ? { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
        : { to: sitePlaces.room(roomId ?? ''), label: 'Zurück zum Raum' }

  if (!reports || fixed) {
    return (
      <NotOffered title="Mangel melden" back={back}>
        {reports ? reportDefectWords.fixed : reportDefectWords.mayNot}
      </NotOffered>
    )
  }

  const name =
    assetId !== undefined
      ? [maybeText(asset, 'number'), maybeText(asset, 'name')].filter(Boolean).join(' ')
      : `Raum ${titleOfRoom(room)}`
  const where = [
    maybeText(building, 'name'),
    assetId !== undefined && room ? titleOfRoom(room) : null,
  ]
    .filter(Boolean)
    .join(', ')

  async function report(event?: FormEvent) {
    event?.preventDefault()
    setTrouble(null)

    const wanted = {
      description: remark.trim(),
      foundOn: maybeText(activity, 'performedOn') ?? today(),
    }
    const wrong = defectProblems(wanted)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(reportDefectWords.check)

      return
    }

    setWorking(true)

    try {
      const begun =
        params.activityId === undefined ? null : await beginActivity(client, params.activityId)

      if (begun !== null) {
        setTrouble(begun)

        return
      }

      const made = await client.create('defects', {
        ...wanted,
        propertyId,
        ...(assetId !== undefined ? { assetId } : { roomId }),
        ...(params.activityId === undefined ? {} : { foundInActivityId: params.activityId }),
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      for (const photo of photos) {
        const problem = await fileDocument(
          client,
          { propertyId: propertyId ?? '', defectId: made.id },
          photo,
        )

        if (problem !== null) {
          setTrouble(reportDefectWords.photoNotFiled)

          return
        }
      }

      void navigate({ to: back.to })
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
      <SiteHeader title="Mangel melden" sub={reportDefectWords.sub} back={back} />
      <SiteScreen>
        <Panel title={reportDefectWords.where}>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-ink-muted" aria-hidden="true">
              {assetId !== undefined ? <Zap size={22} /> : <DoorOpen size={22} />}
            </span>
            <div className="min-w-0 grow">
              <div className="text-[17px] font-semibold [overflow-wrap:anywhere]">{name}</div>
              {where === '' ? null : <div className="text-[15px] text-ink-muted">{where}</div>}
            </div>
          </div>
        </Panel>
        <TextArea
          label={reportDefectWords.remark}
          rows={3}
          required
          starred
          maxLength={defectLimits.description}
          value={remark}
          problem={problems['description']}
          onChange={(event) => {
            setRemark(event.target.value)
          }}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {photos.map((photo) => (
            <span
              key={`${photo.name}-${String(photo.size)}`}
              className="rounded-control border border-line px-2 py-1 text-[13px] text-ink-muted"
            >
              {photo.name}
            </span>
          ))}
          <Button
            icon={Camera}
            height={44}
            disabled={working}
            onClick={() => {
              picker.current?.click()
            }}
          >
            {reportDefectWords.takePhoto}
          </Button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label={reportDefectWords.photoField}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]

              setPhotos((before) => [...before, ...files])
              event.target.value = ''
            }}
          />
        </div>
        <SiteText muted size={15}>
          {reportDefectWords.classLater}
        </SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={reportDefectWords.saved}>
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
