import {
  labelAssignmentRefusal,
  labelAssignmentSentence,
  labelCodeFromScan,
  printedLabelCode,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteFacts,
  SiteHeader,
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
import { Check, QrCode, ScanLine } from 'lucide-react'
import { useState } from 'react'

import { labelMessages, useLabelLookup, useLabelsOf } from '../../app/labels.js'
import { titleOfRoom } from '../../app/place-records.js'
import { assetTitle, CameraFrame, CameraPicture, NotOffered, NotOnDevice } from '../kit.js'
import { sitePlaces, stockTaking } from '../places.js'

export const giveLabelWords = {
  mayNot: 'Etiketten zuordnen gehört nicht zu den Rechten dieses Zugangs.',
  hold: 'Halten Sie ein Etikett vom Bogen in den Rahmen. Den Bogen druckt das Büro.',
  scanned: 'Gescannt, noch keiner Anlage zugeordnet.',
  forGood:
    'Ein Etikett trägt einen eigenen Code und nicht die Nummer der Anlage. Es gehört ihr, bis es gesperrt wird.',
  noNumber: 'Nummer folgt',
  searching: 'Einen Moment, das Etikett wird gesucht.',
  notALabel: 'Der Code gehört zu keinem Etikett dieser Anwendung.',
} as const

const cameraWords = {
  noReader: 'Dieses Gerät liest keine QR-Codes. Ein Etikett legt dann das Büro an der Akte an.',
  noCamera:
    'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Ein Etikett legt dann das Büro an der Akte an.',
}

/**
 * A label from a sheet, given to an asset on site (#99, board "Etikett
 * zuordnen", 4.2 of the concept: "Etikett kleben und zuordnen"). The camera
 * reads the label, the screen says which asset gets it, and "Zuordnen" queues
 * it, also without a network: the device holds the labels of its places, the
 * ones of a sheet included.
 *
 * Whether the label may be given is the rule of `domain`, asked here before
 * anything is queued and by the server again: a label that is blocked, hangs
 * on something or was printed for another property is not given, and an
 * asset keeps to one valid label. An asset made on this device a moment ago
 * gets its label in the same exchange.
 */
export function GiveLabelScreen() {
  const { assetId } = useParams({ strict: false }) as { assetId?: string }
  const asset = useRecord('assets', assetId)
  const records = useRight('asset.record')
  const [scanned, setScanned] = useState<string | null>(null)
  const [foreign, setForeign] = useState(false)

  if (!asset || assetId === undefined) {
    return (
      <NotOnDevice
        what="Diese Anlage"
        back={{ to: stockTaking.start, label: 'Zurück zu Aufnehmen' }}
      />
    )
  }

  const back = { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }

  if (!records) {
    return (
      <NotOffered title="Etikett zuordnen" back={back}>
        {giveLabelWords.mayNot}
      </NotOffered>
    )
  }

  const again = () => {
    setScanned(null)
    setForeign(false)
  }
  const sub = maybeText(asset, 'number') ? assetTitle(asset) : `Neue Anlage: ${text(asset, 'name')}`

  if (foreign) {
    return (
      <>
        <SiteHeader title="Etikett zuordnen" sub={sub} back={back} />
        <SiteScreen>
          <SiteTrouble>{giveLabelWords.notALabel}</SiteTrouble>
        </SiteScreen>
        <SiteActionBar>
          <Button wide height={60} icon={ScanLine} onClick={again}>
            Anderes scannen
          </Button>
        </SiteActionBar>
      </>
    )
  }

  if (scanned !== null) {
    return <Scanned code={scanned} asset={asset} sub={sub} back={back} onAgain={again} />
  }

  return (
    <LabelCamera
      sub={sub}
      back={back}
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

function LabelCamera({
  sub,
  back,
  onCode,
}: {
  readonly sub: string
  readonly back: { readonly to: string; readonly label: string }
  readonly onCode: (read: string) => void
}) {
  const { video, trouble } = useCodeReading(true, onCode, cameraWords)

  return (
    <>
      <SiteHeader title="Etikett zuordnen" sub={sub} back={back} />
      <CameraFrame hint={trouble ? null : giveLabelWords.hold}>
        <CameraPicture video={video} trouble={trouble} shape="square" />
      </CameraFrame>
    </>
  )
}

/** A code that was read: the label it belongs to and the asset that gets it, or why it gets none. */
function Scanned({
  code,
  asset,
  sub,
  back,
  onAgain,
}: {
  readonly code: string
  readonly asset: RecordState
  readonly sub: string
  readonly back: { readonly to: string; readonly label: string }
  readonly onAgain: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const assetId = String(asset['id'])
  const lookup = useLabelLookup(code)
  const label = useRecords('labels').find((each) => text(each, 'code') === code) ?? null
  const { valid: own } = useLabelsOf('assets', assetId)
  const building = useRecord('buildings', maybeText(asset, 'buildingId') ?? undefined)
  const room = useRecord('rooms', maybeText(asset, 'roomId') ?? undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  // The property of an asset made a moment ago is the one of its building.
  const propertyId = maybeText(asset, 'propertyId') ?? maybeText(building, 'propertyId')
  const refusal = label ? labelAssignmentRefusal(label, { propertyId }, own !== null) : null
  // What the scan says where the device holds no such label: the words of
  // the scanner, none of which names what a label hangs on.
  const message =
    label !== null
      ? refusal === null
        ? null
        : labelAssignmentSentence[refusal]
      : lookup.state === 'waiting'
        ? null
        : lookup.state === 'asset' || lookup.state === 'room'
          ? labelAssignmentSentence.taken
          : lookup.state === 'unassigned'
            ? null
            : labelMessages[lookup.state].text

  const give = async () => {
    if (!label) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const given = await client.update('labels', String(label['id']), { assetId })

      if (given.outcome === 'refused') {
        setTrouble(refusalFor(given))

        return
      }

      void navigate({ to: sitePlaces.asset(assetId) })
    } finally {
      setWorking(false)
    }
  }

  const where = [maybeText(building, 'name'), room ? titleOfRoom(room) : null]
    .filter((part) => part !== null && part !== '')
    .join(', ')
  const mayGive = label !== null && refusal === null

  return (
    <>
      <SiteHeader title="Etikett zuordnen" sub={sub} back={back} />
      <SiteScreen>
        <Panel title="Etikett">
          <div className="flex items-center gap-3">
            <QrCode size={40} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
            <div className="min-w-0">
              <p className="numeric text-[17px] font-semibold [overflow-wrap:anywhere]">
                {printedLabelCode(code)}
              </p>
              {mayGive ? <SiteText muted>{giveLabelWords.scanned}</SiteText> : null}
              {label === null && lookup.state === 'waiting' ? (
                <SiteText muted>{giveLabelWords.searching}</SiteText>
              ) : null}
            </div>
          </div>
        </Panel>
        {message ? <SiteTrouble>{message}</SiteTrouble> : null}
        {mayGive ? (
          <>
            <Panel title="Bekommt das Etikett">
              <SiteFacts
                facts={[
                  {
                    label: 'Anlage',
                    value: maybeText(asset, 'number')
                      ? assetTitle(asset)
                      : `${text(asset, 'name')}, ${giveLabelWords.noNumber}`,
                  },
                  ...(where === '' ? [] : [{ label: 'Ort', value: where }]),
                ]}
              />
            </Panel>
            <SiteText muted size={15}>
              {giveLabelWords.forGood}
            </SiteText>
          </>
        ) : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar>
        <Button wide height={60} icon={ScanLine} onClick={onAgain}>
          Anderes scannen
        </Button>
        {mayGive ? (
          <Button
            tone="primary"
            wide
            height={60}
            icon={Check}
            disabled={working}
            onClick={() => {
              void give()
            }}
          >
            Zuordnen
          </Button>
        ) : null}
      </SiteActionBar>
    </>
  )
}
