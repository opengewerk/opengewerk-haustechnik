import {
  type ActivityKind,
  activityKindLabel,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { SiteActionBar, SiteHeader, SiteScreen, SiteText } from '@opengewerk/platform-web/site'
import { maybeText, text, useRecord } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { House, Trash2 } from 'lucide-react'

export const emptiedWords = {
  mark: 'Gelöscht',
  why: 'nach Ablauf der Aufbewahrung seines letzten Nachweises.',
  of: (kind: string, on: string | null) => (on === null ? kind : `${kind} vom ${date(on)}`),
  gone: 'Was der Vorgang hielt, ist gelöscht, im Büro und auf diesem Gerät. Es bleibt, dass es ihn gab.',
  toStart: 'Zum Start',
} as const

/**
 * An activity emptied with its last evidence after the end of the retention
 * (#409), reached on a device that held it, the board "Vorgang mit seinem
 * letzten Nachweis gelöscht (2.6)": what it was and that it is gone. The
 * device let go of what it held with the next pull; nothing here to fill in.
 */
export function EmptiedOnSite({ activity }: { readonly activity: RecordState }) {
  const navigate = useNavigate()
  const asset = useRecord('assets', maybeText(activity, 'assetId') ?? '')
  const kind = activityKindLabel[text(activity, 'kind') as ActivityKind]
  const sub =
    asset === null
      ? undefined
      : [maybeText(asset, 'number'), maybeText(asset, 'name')].filter(Boolean).join(' ')

  return (
    <>
      <SiteHeader title={kind} sub={sub} back={{ to: '/', label: emptiedWords.toStart }} />
      <SiteScreen>
        <div className="rounded-[8px] border border-line bg-surface-sunken px-4 py-5 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-ink-muted text-on-status">
            <Trash2 size={28} strokeWidth={2} aria-hidden="true" />
          </span>
          <h2 className="mt-2.5 text-[22px] font-bold text-ink">{emptiedWords.mark}</h2>
          <p className="mt-1 text-[16px] leading-[1.4] text-ink">{emptiedWords.why}</p>
          <p className="mt-1.5 text-[14px] text-ink-muted">
            {emptiedWords.of(kind, maybeText(activity, 'performedOn'))}
          </p>
        </div>
        <SiteText muted size={15}>
          {emptiedWords.gone}
        </SiteText>
      </SiteScreen>
      <SiteActionBar>
        <Button
          tone="dark"
          wide
          height={60}
          icon={House}
          onClick={() => {
            void navigate({ to: '/' })
          }}
        >
          {emptiedWords.toStart}
        </Button>
      </SiteActionBar>
    </>
  )
}
