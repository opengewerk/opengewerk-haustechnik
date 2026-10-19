import { Button } from '@opengewerk/platform-web'
import {
  type CameraWords,
  SiteActionBar,
  SiteHeader,
  useCodeReading,
} from '@opengewerk/platform-web/site'
import { Check, Pencil } from 'lucide-react'
import { useState } from 'react'

import { CameraFrame, CameraPicture } from './kit.js'

/**
 * The camera on a serial number, board "Seriennummer lesen": it reads the
 * code beside a serial number, on the type plate of an asset (#99) or the
 * label of a PV module (#461), and shows what it read; the person takes it or
 * types the number after all. What the code says is a serial number only
 * where `accept` makes one of it: a label of this application held in front
 * of it is passed over. Everything happens on the device, without a network.
 */
export function SerialReader({
  sub,
  hint,
  words,
  accept,
  onTake,
  onClose,
}: {
  /** What the number is read for, under the heading, where there is something to say. */
  readonly sub?: string
  /** What to hold in front of the camera. */
  readonly hint: string
  readonly words: CameraWords
  /** The serial number in what a code says, or null where it is none. */
  readonly accept: (code: string) => string | null
  readonly onTake: (serialNumber: string) => void
  readonly onClose: () => void
}) {
  const [read, setRead] = useState<string | null>(null)
  const { video, trouble } = useCodeReading(
    true,
    (code) => {
      const serial = accept(code)

      if (serial !== null) {
        setRead(serial)
      }
    },
    words,
  )

  return (
    <>
      <SiteHeader title="Seriennummer lesen" {...(sub === undefined ? {} : { sub })} />
      <CameraFrame hint={trouble ? null : read === null ? hint : `Erkannt: ${read}. ${hint}`}>
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
