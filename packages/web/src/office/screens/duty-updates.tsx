import {
  type Catalogue,
  type CatalogueReview,
  type DeadlineInterval,
  dutyInterval,
  dutyLimits,
  dutyTermWords,
  type DutyUpdate,
  type DutyUpdateEntry,
  dutyUpdateFieldLabel,
  type DutyUpdates,
  intervalWords,
  type IsoDate,
  onceWords,
  type RecordState,
  sameInterval,
  updatesSentence,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Panel,
  PanelLabel,
  Status,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, FactList, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, ChevronDown, ChevronUp, ClipboardCheck, Info } from 'lucide-react'
import { useId, useState } from 'react'

import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt } from '../../sync/made-at.js'
import { dutyPlaces, dutyRegisterPlace } from '../duty-addresses.js'
import { LinkButton } from '../link-button.js'
import { factLink } from '../links.js'
import { packageOf } from '../proposal-addresses.js'

/**
 * What a new version of a package changes for the duties that are confirmed,
 * `neue_fassung()` of the boards (#139, section 2.3 of the concept): by duty
 * kind what reads differently and from when, the duties it is about, each
 * with its interval today and what becomes of it, and the two decisions.
 *
 * A confirmed duty does not change quietly: the server works the report out
 * each time it is read, and what is kept is the decision, on the duty.
 * Whoever keeps the register decides; everybody else who reads duties sees
 * what changes without the buttons.
 */

export const updateWords = {
  title: 'Neue Fassung im Katalog',
  intro:
    'Eine bestätigte Pflicht ändert sich nicht von selbst: Sie übernehmen die neue Fassung oder lassen die Pflicht, wie sie ist, mit Begründung. Nur eine kürzere Höchstfrist gilt ab ihrem Tag auch ohne Übernahme.',
  none: 'Der Katalog sagt über keine bestätigte Pflicht in Ihren Bereichen etwas Neues.',
  unread: 'Die Meldung kommt vom Server, mit Verbindung.',
  loading: 'Die Meldung wird geladen.',
  mayNot: 'Übernehmen und so lassen kann, wer das Pflichtenverzeichnis führt.',
  choose:
    'Öffnen Sie eine Pflichtart. Was Sie dort auswählen, übernehmen Sie hier oder lassen es mit Begründung, wie es ist.',
  intervalStays:
    'Ihre Frist bleibt, wo sie innerhalb der neuen Höchstfrist liegt; sonst wird sie die neue Höchstfrist.',
  keepHint:
    'Pflicht beim Lassen. Begründung und Fassung bleiben an der Pflicht festgehalten, wer entschieden hat im Änderungsprotokoll.',
  keepPlaceholder: 'Warum die Pflicht bleibt, wie sie ist',
  noReason: 'Die Begründung fehlt.',
  noConnection: 'Übernommen und so gelassen wird mit Verbindung. Gerade ist keine da.',
  onlyWording: 'Nur der Wortlaut der Pflichtart ändert sich.',
  mark: 'Neue Fassung',
  shortened: 'Durch Vorschrift verkürzt',
  look: 'Ansehen und übernehmen',
} as const

/** Where the report lives: under the register, before the page of a duty, as "fassungen" is no id. */
export const dutyUpdatesPlace = '/pflichten/fassungen'

/** The report as the route reads it, under the duties, which a decision changes. */
export const dutyUpdatesQuery = {
  queryKey: ['duties', 'updates'],
  queryFn: () => request<DutyUpdates>('/duties/updates'),
  // A refusal is an answer: asking again brings the same one.
  retry: (count: number, error: unknown) => !(error instanceof RequestRefused) && count < 2,
} as const

/** What a decision makes the screens read again: the duties, and what was read of the assets. */
async function afterADecision(queries: ReturnType<typeof useQueryClient>): Promise<void> {
  await queries.invalidateQueries({ queryKey: ['duties'] })
  queries.removeQueries({ queryKey: ['assets'] })
}

/** "3 Pflichten", "1 Pflicht". */
export function dutiesWords(count: number): string {
  return count === 1 ? '1 Pflicht' : `${count.toLocaleString('de-DE')} Pflichten`
}

/** "mit 12 Monaten", "mit 1 Tag": the interval a duty counts with, after "zählt". */
function countsWith(interval: DeadlineInterval): string {
  if ('days' in interval) {
    return interval.days === 1 ? 'mit 1 Tag' : `mit ${String(interval.days)} Tagen`
  }

  return interval.months === 1 ? 'mit 1 Monat' : `mit ${String(interval.months)} Monaten`
}

/**
 * "Neue Fassung" under the interval of a row, `update_mark()` of the boards,
 * or what a regulation did to the interval: "Durch Vorschrift verkürzt", and
 * with `counts` the interval the duty counts with behind it, where the row
 * itself still shows the one it was confirmed with. In words and with a
 * symbol.
 */
export function UpdateMark({
  shortened = false,
  counts,
}: {
  readonly shortened?: boolean
  readonly counts?: DeadlineInterval
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-waiting">
      <Info size={12} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
      {shortened
        ? counts === undefined
          ? updateWords.shortened
          : `${updateWords.shortened}, zählt ${countsWith(counts)}`
        : updateWords.mark}
    </span>
  )
}

/** "Neue Fassung" beside the state of a duty in the head of its page. */
export function UpdateStatus() {
  return (
    <Status tone="waiting" icon={Info}>
      {updateWords.mark}
    </Status>
  )
}

/** What the page of a duty says first about a new version: which one, and from when. */
function versionSentence(update: DutyUpdate, on: IsoDate): string {
  if (update.newest === null) {
    return update.obstacle ?? ''
  }

  if (update.newest === update.held || update.from === null) {
    return 'Die Vorschrift nennt für diese Pflichtart eine andere Frist.'
  }

  return `Fassung ${String(update.newest)} der Pflichtart gilt ${update.from <= on ? 'seit dem' : 'ab dem'} ${date(update.from)}.`
}

/**
 * The card "Neue Fassung" on the page of a duty, the first beside the page:
 * what the catalogue says differently, and the way to the decision.
 */
export function UpdatePanel({ update }: { readonly update: DutyUpdate }) {
  const keeps = useRight('duty.write')

  return (
    <Panel title={updateWords.mark}>
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-[1.45] text-ink-muted">
          {versionSentence(update, today())}
          {update.lapse === 'out_of_scope' ? ` ${update.obstacle ?? ''}` : ''}
          {update.lapse === null && update.changes.length === 0
            ? ` ${updateWords.onlyWording}`
            : ''}
        </p>
        {update.changes.length > 0 ? (
          <FactList
            keyWidth={130}
            facts={update.changes.map((change) => ({
              label: dutyUpdateFieldLabel[change.field],
              value: `${change.held}, neu ${change.newest}`,
            }))}
          />
        ) : null}
        <LinkButton to={dutyUpdatesPlace} size="small">
          {keeps ? updateWords.look : 'Ansehen'}
        </LinkButton>
      </div>
    </Panel>
  )
}

/**
 * The note in the card "Frist" of a duty a shorter maximum applies to: from
 * its day the appointment counts with it, and the duty keeps the interval it
 * was confirmed with until somebody takes the new version over.
 */
export function shorterNote(
  shorter: NonNullable<DutyUpdate['shorter']>,
  own: DeadlineInterval,
  on: IsoDate,
): string {
  return shorter.from <= on
    ? `Seit dem ${date(shorter.from)} beträgt die Höchstfrist ${intervalWords(shorter.interval)}. Der Termin rechnet mit ihr; die Pflicht nennt weiter ${intervalWords(own)}, bis jemand die neue Fassung übernimmt.`
    : `Ab dem ${date(shorter.from)} beträgt die Höchstfrist ${intervalWords(shorter.interval)}. Von diesem Tag an rechnet der Termin mit ihr, auch ohne Übernahme.`
}

/** The title of a package as this device knows it, or its name. */
function packageTitle(catalogue: Catalogue | null, kind: string): string {
  const name = packageOf(kind)

  return catalogue?.packages.find((each) => each.name === name)?.title ?? name
}

/**
 * The note of a new version of a package, `update_note()` of the boards: one
 * sentence for each package that changes something for a confirmed duty, and
 * the way to the decision. Over the proposals, the register and the overview
 * it speaks of every package; at a package of the catalogue, of that one.
 * Nothing stands where nothing changed.
 */
export function DutyUpdatesNote({ packageName }: { readonly packageName?: string }) {
  const read = useQuery(dutyUpdatesQuery)
  const catalogue = useCatalogue()
  const keeps = useRight('duty.write')
  const byPackage = new Map<string, DutyUpdate[]>()

  for (const entry of read.data?.entries ?? []) {
    const name = packageOf(entry.kind)

    if (packageName === undefined || name === packageName) {
      byPackage.set(name, [...(byPackage.get(name) ?? []), entry.update])
    }
  }

  if (byPackage.size === 0) {
    return null
  }

  return (
    <NoteBox
      tone="waiting"
      icon={Info}
      action={
        <LinkButton to={dutyUpdatesPlace} size="small">
          {keeps ? updateWords.look : 'Ansehen'}
        </LinkButton>
      }
    >
      {[...byPackage.entries()]
        .map(([name, updates]) =>
          updatesSentence(
            catalogue?.packages.find((each) => each.name === name)?.title ?? name,
            updates,
            today(),
          ),
        )
        .join(' ')}
    </NoteBox>
  )
}

/** A group of the report: the duties of one kind that the catalogue says the same about. */
interface UpdateGroup {
  readonly key: string
  readonly kind: string
  readonly update: DutyUpdate
  readonly entries: readonly DutyUpdateEntry[]
}

/** What makes two updates one group: the same versions, the same day and the same things that change. */
function sameAs(update: DutyUpdate): string {
  return JSON.stringify([update.held, update.newest, update.from, update.changes, update.lapse])
}

function groupsOf(entries: readonly DutyUpdateEntry[]): UpdateGroup[] {
  const groups = new Map<string, UpdateGroup>()

  for (const entry of entries) {
    const key = `${entry.kind} ${sameAs(entry.update)}`
    const group = groups.get(key)

    groups.set(key, {
      key,
      kind: entry.kind,
      update: entry.update,
      entries: [...(group?.entries ?? []), entry],
    })
  }

  return [...groups.values()]
}

/** "Trinkwasser · Fassung 2, neu Fassung 3 · gilt ab dem 01.01.2027": what a group is about. */
export function updateLine(packageName: string, update: DutyUpdate, on: IsoDate): string {
  if (update.newest === null) {
    return [packageName, `Fassung ${String(update.held)}`, 'nicht mehr im Katalog'].join(' · ')
  }

  if (update.newest === update.held || update.from === null) {
    return [packageName, `Fassung ${String(update.held)}`, 'geänderte Regel der Frist'].join(' · ')
  }

  return [
    packageName,
    `Fassung ${String(update.held)}, neu Fassung ${String(update.newest)}`,
    `gilt ${update.from <= on ? 'seit dem' : 'ab dem'} ${date(update.from)}`,
  ].join(' · ')
}

/** What becomes of the interval of a duty that takes the newest version over, or why it cannot. */
function becomesWords(entry: DutyUpdateEntry): string {
  const { update } = entry

  // A duty that falls due once takes the due day of the newest version (#439).
  if (update.becomesDue !== null) {
    return `${update.becomesDue === entry.dueOn ? 'bleibt' : 'wird'} ${onceWords(update.becomesDue)}`
  }

  if (update.becomes === null) {
    return update.obstacle ?? ''
  }

  const own = dutyInterval(entry)

  return `${own !== null && sameInterval(update.becomes, own) ? 'bleibt' : 'wird'} ${intervalWords(update.becomes)}`
}

/** Where a duty hangs: "AN-00095 · Wohnanlage Birkenweg, Haus 2". */
function placeOf(
  entry: DutyUpdateEntry,
  properties: readonly RecordState[],
  buildings: readonly RecordState[],
): string {
  const property = properties.find((record) => record['id'] === entry.propertyId)
  const building = buildings.find((record) => record['id'] === entry.asset?.buildingId)

  return [
    entry.asset?.number,
    [maybeText(property ?? null, 'name'), maybeText(building ?? null, 'name')]
      .filter(Boolean)
      .join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
}

export function DutyUpdatesScreen() {
  const keeps = useRight('duty.write')
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const read = useQuery(dutyUpdatesQuery)
  const on = today()
  // Undefined: the first group stands open; null: none does.
  const [open, setOpen] = useState<string | null | undefined>(undefined)
  const [chosen, setChosen] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const entries = read.data?.entries ?? []
  const groups = groupsOf(entries)
  const openKey = open === undefined ? (groups[0]?.key ?? null) : open
  const openGroup = groups.find((group) => group.key === openKey) ?? null
  // What is chosen in the open group: all of it when it opens, and never a
  // duty that has left it since.
  const chosenIds = new Set(
    (openGroup?.entries ?? [])
      .map((entry) => entry.id)
      .filter((id) => chosen?.key !== openKey || chosen.ids.has(id)),
  )
  const assetCount = new Set(entries.map((entry) => entry.asset?.id ?? entry.id)).size

  return (
    <Screen>
      <PageHead
        title={updateWords.title}
        crumbs={[dutyRegisterPlace]}
        phoneBack={dutyRegisterPlace}
        {...(read.data
          ? {
              count: `${entries.length === 1 ? '1 bestätigte Pflicht' : `${entries.length.toLocaleString('de-DE')} bestätigte Pflichten`} an ${assetCount === 1 ? '1 Anlage' : `${assetCount.toLocaleString('de-DE')} Anlagen`}`,
            }
          : {})}
        actions={
          <LinkButton to={dutyRegisterPlace.to} icon={ClipboardCheck}>
            Zum Pflichtenverzeichnis
          </LinkButton>
        }
      />
      <NoteBox>{updateWords.intro}</NoteBox>
      {done ? (
        <p role="status" className="text-[13px] font-medium text-done">
          {done}
        </p>
      ) : null}
      {read.data === undefined ? (
        <Empty>
          {read.isError || read.fetchStatus === 'paused' ? updateWords.unread : updateWords.loading}
        </Empty>
      ) : groups.length === 0 ? (
        <Empty>{updateWords.none}</Empty>
      ) : (
        <div
          className={
            keeps
              ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]'
              : 'flex flex-col gap-2.5'
          }
        >
          <div className="flex min-w-0 flex-col gap-2.5">
            {groups.map((group) => (
              <Group
                key={group.key}
                group={group}
                label={labelOf(catalogue, group)}
                line={updateLine(packageTitle(catalogue, group.kind), group.update, on)}
                review={catalogue?.newestDutyKind(group.kind)?.review ?? null}
                open={group.key === openKey}
                keeps={keeps}
                chosen={group.key === openKey ? chosenIds : new Set()}
                place={(entry) => placeOf(entry, properties, buildings)}
                onToggle={() => {
                  setOpen(group.key === openKey ? null : group.key)
                }}
                onChoose={(ids) => {
                  setChosen({ key: group.key, ids })
                }}
              />
            ))}
          </div>
          {keeps ? (
            <Decision
              key={openKey ?? ''}
              group={openGroup}
              label={openGroup === null ? '' : labelOf(catalogue, openGroup)}
              chosen={openGroup?.entries.filter((entry) => chosenIds.has(entry.id)) ?? []}
              onDone={setDone}
            />
          ) : (
            <p className="text-[13px] text-ink-muted">{updateWords.mayNot}</p>
          )}
        </div>
      )}
    </Screen>
  )
}

/** What a group is called: its kind in the newest version this device knows, or as its duties call it. */
function labelOf(catalogue: Catalogue | null, group: UpdateGroup): string {
  return (
    catalogue?.newestDutyKind(group.kind)?.definition.label ?? group.entries[0]?.title ?? group.kind
  )
}

/** A checkbox of a row or of the whole group, `box()` of the board. */
function Tick({
  label,
  checked,
  mixed = false,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly mixed?: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(element) => {
        if (element) {
          element.indeterminate = mixed
        }
      }}
      className="size-4 shrink-0 cursor-pointer accent-copper-solid max-lg:size-5"
      onChange={(event) => {
        onChange(event.target.checked)
      }}
    />
  )
}

/** One duty kind of the report, closed or open with what changes and the duties it is about. */
function Group({
  group,
  label,
  line,
  review,
  open,
  keeps,
  chosen,
  place,
  onToggle,
  onChoose,
}: {
  readonly group: UpdateGroup
  readonly label: string
  readonly line: string
  readonly review: CatalogueReview | null
  readonly open: boolean
  readonly keeps: boolean
  readonly chosen: ReadonlySet<string>
  readonly place: (entry: DutyUpdateEntry) => string
  readonly onToggle: () => void
  readonly onChoose: (ids: ReadonlySet<string>) => void
}) {
  const { update, entries } = group
  const ids = entries.map((entry) => entry.id)
  const nameOf = (entry: DutyUpdateEntry) => entry.asset?.name ?? entry.title
  const tick = (entry: DutyUpdateEntry) => (
    <Tick
      label={`${nameOf(entry)} auswählen`}
      checked={chosen.has(entry.id)}
      onChange={(checked) => {
        const next = new Set(chosen)

        if (checked) {
          next.add(entry.id)
        } else {
          next.delete(entry.id)
        }

        onChoose(next)
      }}
    />
  )
  const linkOf = (entry: DutyUpdateEntry) => (
    <Link to={dutyPlaces.duty(entry.id)} className={factLink}>
      {nameOf(entry)}
    </Link>
  )
  const becomes = (entry: DutyUpdateEntry) =>
    entry.update.shorter !== null && entry.update.becomes !== null ? (
      <span className="inline-flex items-center gap-[5px] font-semibold text-waiting">
        <Info size={13} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
        {becomesWords(entry)}
      </span>
    ) : (
      <span className="text-ink-muted">{becomesWords(entry)}</span>
    )
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-[5px] border border-line bg-surface px-3.5 py-3 [--surface-here:var(--color-surface)]"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 grow">
          <div className="flex flex-wrap items-center gap-[9px]">
            <h2 id={headingId} className="m-0 text-[15px] font-semibold">
              {label}
            </h2>
            {review ? <ReviewMarks review={review} /> : null}
          </div>
          <div className="mt-[3px] text-[13px] text-ink-muted">{line}</div>
        </div>
        <span className="text-[13px] whitespace-nowrap text-ink-faint max-sm:hidden">
          {dutiesWords(entries.length)}
        </span>
        <Button
          size="small"
          icon={open ? ChevronUp : ChevronDown}
          aria-expanded={open}
          aria-label={`${open ? 'Schließen' : 'Öffnen'}: ${label}`}
          onClick={onToggle}
        >
          {open ? 'Schließen' : 'Öffnen'}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {update.lapse !== null ? (
            <NoteBox tone="waiting" icon={Info}>
              {update.obstacle}{' '}
              {update.lapse === 'out_of_scope'
                ? 'Lassen Sie die Pflicht mit Begründung, wie sie ist, oder beenden Sie sie auf ihrer Seite.'
                : 'Die Pflicht bleibt, bis jemand sie auf ihrer Seite beendet.'}
            </NoteBox>
          ) : update.changes.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{updateWords.onlyWording}</p>
          ) : (
            <TablePanel
              caption={`${label}: was sich ändert`}
              cards={update.changes.map((change) => ({
                key: change.field,
                title: dutyUpdateFieldLabel[change.field],
                sub: `${change.held}, neu ${change.newest}`,
              }))}
            >
              <thead>
                <tr>
                  <Column className="w-[190px]">Was sich ändert</Column>
                  <Column>Bisher</Column>
                  <Column>Neu</Column>
                </tr>
              </thead>
              <tbody>
                {update.changes.map((change) => (
                  <tr key={change.field}>
                    <Cell>{dutyUpdateFieldLabel[change.field]}</Cell>
                    <Cell>{change.held}</Cell>
                    <Cell className="font-semibold">{change.newest}</Cell>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )}
          <TablePanel
            caption={`${label}: ${dutiesWords(entries.length)}, mit der Frist heute und mit der neuen Fassung`}
            cards={entries.map((entry) => ({
              key: entry.id,
              title: linkOf(entry),
              sub: [place(entry), `Frist ${dutyTermWords(entry)}`, becomesWords(entry)]
                .filter(Boolean)
                .join(' · '),
              ...(keeps ? { right: tick(entry) } : {}),
            }))}
            footer={
              keeps ? (
                <label className="flex items-center gap-2">
                  <Tick
                    label={`Alle ${String(entries.length)} auswählen`}
                    checked={chosen.size === entries.length}
                    mixed={chosen.size > 0 && chosen.size < entries.length}
                    onChange={(checked) => {
                      onChoose(new Set(checked ? ids : []))
                    }}
                  />
                  <span>
                    {chosen.size} von {entries.length} ausgewählt
                  </span>
                </label>
              ) : undefined
            }
          >
            <thead>
              <tr>
                {keeps ? (
                  <Column className="w-[34px]">
                    <span className="sr-only">Auswahl</span>
                  </Column>
                ) : null}
                <Column>Pflicht an</Column>
                <Column className="w-[110px]">Frist heute</Column>
                <Column className="w-[190px]">Mit der neuen Fassung</Column>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  {keeps ? <Cell>{tick(entry)}</Cell> : null}
                  <Cell>
                    <div className="leading-[1.32]">
                      <div className="font-medium">{linkOf(entry)}</div>
                      <div className="text-[12px] text-ink-faint">{place(entry)}</div>
                    </div>
                  </Cell>
                  <Cell>{dutyTermWords(entry)}</Cell>
                  <Cell>{becomes(entry)}</Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The card "Auswahl" beside the report: what is chosen in the open group
 * takes the newest version over, or is left as it is with one reason, each in
 * one batch. Each decision goes for the duties it can go for: a duty whose
 * interval lies beyond a new maximum is taken over and never left, and one
 * the new version no longer takes in is left and never taken over.
 */
function Decision({
  group,
  label,
  chosen,
  onDone,
}: {
  readonly group: UpdateGroup | null
  readonly label: string
  readonly chosen: readonly DutyUpdateEntry[]
  /** What was done, said above the list, where it stays when the group is gone. */
  readonly onDone: (said: string | null) => void
}) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  if (group === null) {
    return (
      <Panel title="Auswahl">
        <p className="text-[13px] leading-[1.45] text-ink-muted max-sm:text-[15px]">
          {updateWords.choose}
        </p>
      </Panel>
    )
  }

  const { update } = group
  const toAdopt = chosen.filter((entry) => entry.update.adoptable)
  const toKeep = chosen.filter((entry) => entry.update.keepable)
  const beyond = chosen.filter((entry) => entry.update.shorter !== null).length
  const waiting = working || !status.online

  async function decide(
    decision: 'adopt' | 'keep',
    duties: readonly DutyUpdateEntry[],
    values: Record<string, unknown>,
    said: string,
  ) {
    setTrouble(null)
    onDone(null)
    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/duties/updates/${decision}`, group?.kind ?? '', {
        dutyIds: duties.map((entry) => entry.id),
        ...values,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      onDone(said)
      setReason('')
      await afterADecision(queries)
    } finally {
      setWorking(false)
    }
  }

  function keep() {
    const said = reason.trim()

    if (said === '') {
      setProblem(updateWords.noReason)

      return
    }

    setProblem(undefined)
    void decide(
      'keep',
      toKeep,
      { reason: said },
      `${dutiesWords(toKeep.length)} so gelassen, mit Begründung.`,
    )
  }

  return (
    <Panel title="Auswahl" roomy>
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] text-ink-muted max-sm:text-[15px]">
          {label}, {dutiesWords(chosen.length)}.
        </p>
        {status.online ? null : (
          <p role="status" className="text-[13px] font-medium text-ink-muted">
            {updateWords.noConnection}
          </p>
        )}
        {update.lapse === null ? (
          <p className="text-[12px] leading-[1.45] text-ink-muted">
            {update.newest !== null && update.newest !== update.held
              ? `Übernommen nennt die Pflicht Fassung ${String(update.newest)}. `
              : 'Übernommen trägt die Pflicht, was die Vorschrift jetzt sagt. '}
            {update.changes.some((change) => change.field === 'interval')
              ? updateWords.intervalStays
              : ''}
          </p>
        ) : null}
        <Button
          tone="primary"
          icon={Check}
          wide
          disabled={waiting || toAdopt.length === 0}
          onClick={() => {
            void decide(
              'adopt',
              toAdopt,
              {},
              `${dutiesWords(toAdopt.length)} mit der neuen Fassung übernommen.`,
            )
          }}
        >
          {working ? 'Einen Moment' : `${dutiesWords(toAdopt.length)} übernehmen`}
        </Button>
        <div className="my-0.5 h-px bg-line" />
        <PanelLabel>So lassen</PanelLabel>
        <TextArea
          label="Begründung"
          rows={3}
          value={reason}
          placeholder={updateWords.keepPlaceholder}
          hint={updateWords.keepHint}
          maxLength={dutyLimits.keptReason}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <Button wide disabled={waiting || toKeep.length === 0} onClick={keep}>
          {`${dutiesWords(toKeep.length)} so lassen`}
        </Button>
        {beyond > 0 ? (
          <p className="text-[12px] leading-[1.45] text-ink-muted">
            {chosen.length === 1
              ? 'Diese Pflicht hat eine längere Frist als die neue Höchstfrist. Sie lässt sich nur übernehmen.'
              : beyond === 1
                ? `1 der ${String(chosen.length)} Pflichten hat eine längere Frist als die neue Höchstfrist. Sie lässt sich nur übernehmen.`
                : `${String(beyond)} der ${String(chosen.length)} Pflichten haben eine längere Frist als die neue Höchstfrist. Sie lassen sich nur übernehmen.`}
          </p>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
