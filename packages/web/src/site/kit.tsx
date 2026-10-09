import type { Catalogue, RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { SiteHeader, SiteScreen, SiteText, type WayBack } from '@opengewerk/platform-web/site'
import { maybeText, text } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { type ReactNode, type RefObject, useSyncExternalStore } from 'react'

/**
 * What the screens of this application on site share beyond the kit of the
 * foundation: how an asset is named in one line, a row that leads nowhere,
 * the open defects of a place, a button that goes to another screen, the
 * picture of the camera, what a screen says about a record the device does
 * not hold, and whether the device is a tablet held across.
 */

/** From here the frame stands the tabs as a rail, as on the board "Tablet quer" (10). */
const across = '(min-width: 64rem)'

function holdsAcross(): boolean {
  return globalThis.matchMedia?.(across).matches === true
}

function onTurn(change: () => void): () => void {
  const list = globalThis.matchMedia?.(across)

  list?.addEventListener('change', change)

  return () => {
    list?.removeEventListener('change', change)
  }
}

/**
 * Whether the screen is a tablet held across or wider, from 1024 pixels: the
 * rail of the frame, and two things side by side where a phone shows one
 * after the other. Where the window cannot say, it is a phone, the device
 * every screen on site is drawn for first.
 */
export function useAcross(): boolean {
  return useSyncExternalStore(onTurn, holdsAcross, () => false)
}

/** "AN-00057 Trinkwassererwärmer": the number the server drew and the name, the name alone until then. */
export function assetTitle(asset: RecordState | null | undefined): string {
  return asset
    ? [maybeText(asset, 'number'), text(asset, 'name')].filter(Boolean).join(' ')
    : 'Eine Anlage'
}

/** What an asset kind is called in the catalogue of today, its key where the device knows no such kind. */
export function kindWords(catalogue: Catalogue | null, key: string | null): string {
  return key === null ? '' : (catalogue?.assetKind(key, today())?.definition.label ?? key)
}

/** "3 Räume", "1 Raum", "Noch kein Raum". */
export function countWords(count: number, one: string, many: string, none: string): string {
  return count === 0 ? none : count === 1 ? `1 ${one}` : `${String(count)} ${many}`
}

export const byName = (left: RecordState, right: RecordState) =>
  text(left, 'name').localeCompare(text(right, 'name'), 'de')

/**
 * In place of a page whose record the device does not hold: removed, outside
 * the areas of the person, or made on another device that has not exchanged
 * yet. The page cannot tell which, so it names all three.
 */
export function NotOnDevice({ what, back }: { readonly what: string; readonly back: WayBack }) {
  return (
    <>
      <SiteHeader title="Nicht auf diesem Gerät" back={back} />
      <SiteScreen>
        <SiteText>
          {`${what} hält dieses Gerät nicht. Entweder wurde entfernt, was hier stand, es liegt außerhalb Ihrer Bereiche, oder der Abgleich steht noch aus.`}
        </SiteText>
      </SiteScreen>
    </>
  )
}

/** In place of a form, for whoever may not fill it in or whose device lacks what it needs. */
export function NotOffered({
  title,
  back,
  children,
}: {
  readonly title: string
  readonly back: WayBack
  readonly children: ReactNode
}) {
  return (
    <>
      <SiteHeader title={title} back={back} />
      <SiteScreen>
        <SiteText>{children}</SiteText>
      </SiteScreen>
    </>
  )
}

/** A button at the foot of a page that goes to another screen. */
export function GoButton({
  to,
  icon,
  tone = 'secondary',
  children,
}: {
  readonly to: string
  readonly icon?: LucideIcon
  readonly tone?: 'primary' | 'secondary'
  readonly children: ReactNode
}) {
  const navigate = useNavigate()

  return (
    <Button
      wide
      height={60}
      tone={tone}
      {...(icon ? { icon } : {})}
      onClick={() => {
        void navigate({ to })
      }}
    >
      {children}
    </Button>
  )
}

/** A row that opens nothing, where a record has no page of its own yet. */
export function PlainRow({
  title,
  meta,
}: {
  readonly title: ReactNode
  readonly meta?: ReactNode
}) {
  return (
    <li className="border-b border-row py-2">
      <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">{title}</span>
      {meta ? (
        <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">{meta}</span>
      ) : null}
    </li>
  )
}

/** A defect that still waits: found, or given to a work order that is not done. */
export function isOpenDefect(defect: RecordState): boolean {
  return defect['status'] === 'found' || defect['status'] === 'ordered'
}

/**
 * The open defects of a place, as the device holds them: every one of its
 * areas, also without a network. Each says what was found, when, and by when
 * it is to be set right. Their own page arrives with the defects (#116).
 */
export function OpenDefects({
  defects,
  empty,
  named,
}: {
  readonly defects: readonly RecordState[]
  readonly empty: string
  /** What stands before the day, for a list over several assets: which one. */
  readonly named?: (defect: RecordState) => string | null
}) {
  return (
    <Panel title="Offene Mängel">
      {defects.length === 0 ? (
        <SiteText muted>{empty}</SiteText>
      ) : (
        <ul aria-label="Offene Mängel" className="flex flex-col">
          {defects.map((defect) => {
            const due = maybeText(defect, 'dueOn')

            return (
              <PlainRow
                key={String(defect['id'])}
                title={text(defect, 'description')}
                meta={[
                  named?.(defect) ?? null,
                  `festgestellt am ${date(maybeText(defect, 'foundOn'))}`,
                  due === null ? null : `Frist ${date(due)}`,
                ]
                  .filter((part) => part !== null && part !== '')
                  .join(', ')}
              />
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/**
 * The picture of the camera, `camera_view()` of the boards: dark, with what
 * is laid over it, and under it the sentence that says what to do. No
 * sentence while the picture itself says why there is none.
 */
export function CameraFrame({
  hint,
  children,
}: {
  readonly hint: string | null
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 pb-3.5">
      <div className="relative h-[min(560px,calc(100dvh-240px))] min-h-[340px] overflow-hidden bg-camera text-camera-ink">
        {children}
      </div>
      {hint === null ? null : (
        <p className="px-4 text-[15px] leading-[1.45] text-ink-muted">{hint}</p>
      )}
    </div>
  )
}

/**
 * What the camera shows while it looks for a code: its picture, and over it
 * the frame to hold the code in, a square for a QR code and a wide one for
 * the bar code of a type plate. Where it cannot look, the sentence why.
 */
export function CameraPicture({
  video,
  trouble,
  shape,
}: {
  readonly video: RefObject<HTMLVideoElement | null>
  readonly trouble: string | null
  readonly shape: 'square' | 'wide'
}) {
  return (
    <>
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
      ) : shape === 'square' ? (
        <div
          aria-hidden="true"
          className="absolute top-[46%] left-1/2 aspect-square w-[min(220px,60%)] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border-[3px] border-camera-ink shadow-[0_0_0_2000px_rgb(0_0_0/0.35)]"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute top-[46%] left-1/2 h-[110px] w-[min(300px,80%)] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border-[3px] border-camera-ink shadow-[0_0_0_2000px_rgb(0_0_0/0.35)]"
        />
      )}
    </>
  )
}
