import { labelCodeFromScan } from '@opengewerk/haustechnik-domain'
import { PageHead, Screen } from '@opengewerk/platform-web/office'
import { Navigate } from '@tanstack/react-router'

import {
  type LabelMessage,
  labelMessages,
  labelOpens,
  messageOf,
  useLabelLookup,
} from '../../app/labels.js'

/**
 * The address on a label, `/a/<code>` (#98), opened by the camera of a phone
 * in the browser: signed in, the file of the asset or the page of the room
 * the label hangs on. Somebody not signed in meets the gate first, with a
 * line saying what comes after it.
 *
 * A label that opens nothing says so in the words of the board "Etikett
 * gesperrt, fremd, außerhalb", and none of them names what it hangs on. A
 * blocked label opens nothing for anybody, the Leitung included.
 *
 * The code is read from the address of this very page and not from a
 * parameter of the router, so that it is read the same way the scanner reads
 * it: only the path counts, so a label printed while the instance lived
 * under another address opens here as well.
 */
export function LabelLandingScreen() {
  const code = labelCodeFromScan(globalThis.location.href)

  if (code === null) {
    return <Message message={labelMessages.foreign} />
  }

  return <LandingFor code={code} />
}

function LandingFor({ code }: { readonly code: string }) {
  const lookup = useLabelLookup(code)

  if (lookup.state === 'asset') {
    return <Navigate to={labelOpens.asset(lookup.assetId)} replace />
  }

  if (lookup.state === 'room') {
    return <Navigate to={labelOpens.room(lookup.roomId)} replace />
  }

  const message = messageOf(lookup)

  if (message === null) {
    return (
      <Screen>
        <PageHead title="Etikett" />
        <p role="status" className="text-body text-ink-muted">
          Einen Moment, das Etikett wird gesucht.
        </p>
      </Screen>
    )
  }

  return <Message message={message} />
}

function Message({ message }: { readonly message: LabelMessage }) {
  return (
    <Screen>
      <PageHead title={message.title} />
      <p role="status" className="max-w-[640px] text-body leading-[1.5] text-ink-muted">
        {message.text}
      </p>
    </Screen>
  )
}
