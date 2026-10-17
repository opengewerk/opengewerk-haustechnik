import { labelCodeFromScan } from '@opengewerk/haustechnik-domain'
import { SiteHeader, SiteScreen, SiteText } from '@opengewerk/platform-web/site'
import { text } from '@opengewerk/platform-web/sync'
import { Navigate, useParams } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import { useState } from 'react'

import { answerAt, filledOf, type FormPoint, isAnswered } from '../../app/answers.js'
import { labelMessages, useLabelLookup } from '../../app/labels.js'
import { NotOnDevice } from '../kit.js'
import { siteForms } from '../places.js'
import { useActivityForm } from './form.js'
import { looks, ScanCamera, type ScanHead, ScanMessage } from './scan.js'

/**
 * The label scanned in a round (#343, the boards "Rundgang: Etikett springt
 * zur Anlage" and "Rundgang: Etikett einer anderen Anlage"): the camera looks
 * for the label of an asset the round asks a point for every asset about,
 * and the point of that asset opens at once, also without a network, the
 * first one still open where the round asks about it in more than one. Every
 * other label says why it opens nothing here; its page stands under the tab
 * "Scannen".
 */

export const roundScanWords = {
  title: 'Etikett scannen',
  hint: 'Halten Sie das Etikett einer Anlage dieses Rundgangs in den Rahmen. Ihr Punkt öffnet sich, auch ohne Netz.',
  waiting: 'Einen Moment, das Etikett wird gesucht.',
  elsewhere: {
    title: 'Nicht in diesem Rundgang',
    text: 'Diese Anlage hat in diesem Rundgang keinen Punkt. Ihre Seite öffnet der Reiter Scannen.',
  },
} as const

export function RoundScanScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const form = useActivityForm(activityId, [])
  const [scanned, setScanned] = useState<string | null>(null)
  const [foreign, setForeign] = useState(false)

  if (form.activity === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  const head: ScanHead = {
    title: roundScanWords.title,
    sub: text(form.activity, 'title'),
    back: { to: siteForms.form(activityId), label: 'Zurück zum Rundgang' },
  }
  const again = () => {
    setScanned(null)
    setForeign(false)
  }

  if (foreign) {
    return (
      <ScanMessage
        message={labelMessages.foreign}
        look={looks.foreign}
        onAgain={again}
        head={head}
      />
    )
  }

  if (scanned !== null) {
    return (
      <RoundScanned
        code={scanned}
        activityId={activityId}
        points={form.points}
        answers={form.answers}
        head={head}
        onAgain={again}
      />
    )
  }

  return (
    <ScanCamera
      head={head}
      hint={roundScanWords.hint}
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

/** A label read in a round: the point of its asset, or why it opens none. */
function RoundScanned({
  code,
  activityId,
  points,
  answers,
  head,
  onAgain,
}: {
  readonly code: string
  readonly activityId: string
  readonly points: readonly FormPoint[]
  readonly answers: Parameters<typeof answerAt>[0]
  readonly head: ScanHead
  readonly onAgain: () => void
}) {
  const lookup = useLabelLookup(code)

  if (lookup.state === 'waiting') {
    return (
      <>
        <SiteHeader title={head.title} sub={head.sub} back={head.back} />
        <SiteScreen>
          <SiteText muted>{roundScanWords.waiting}</SiteText>
        </SiteScreen>
      </>
    )
  }

  if (lookup.state === 'asset' || lookup.state === 'room') {
    const ofTheAsset =
      lookup.state === 'asset' ? points.filter((point) => point.assetId === lookup.assetId) : []
    const open = ofTheAsset.find((point) => {
      const held = answerAt(answers, point)

      return !isAnswered(point, held === undefined ? undefined : filledOf(held))
    })
    const target = open ?? ofTheAsset[0]

    if (target !== undefined) {
      return <Navigate to={siteForms.point(activityId, target.key)} replace />
    }

    return (
      <ScanMessage
        message={roundScanWords.elsewhere}
        look={{ icon: Info, tone: 'neutral' }}
        onAgain={onAgain}
        head={head}
      />
    )
  }

  return (
    <ScanMessage
      message={labelMessages[lookup.state]}
      look={looks[lookup.state]}
      onAgain={onAgain}
      head={head}
    />
  )
}
