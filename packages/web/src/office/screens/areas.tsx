import {
  type Area,
  areaNameMaxLength,
  areaNameProblem,
  type MemberAreas,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  type TableCard,
  TablePanel,
} from '@opengewerk/platform-web'
import { NoteBox, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { areasQuery } from '../../session/areas.js'
import { memberAreasQuery } from '../staff-areas.js'

/**
 * "Bereiche" among the settings (section 2.8 of the concept, the boards
 * `bereiche`, `bereich_anlegen`, `bereich_umbenennen`, `bereich_entfernen` and
 * `bereich_entfernen_leer`): which properties belong together, and who sees
 * them.
 *
 * Read with the right to see the settings, kept with the right to change
 * them, at the routes under `/areas`. An area is made and renamed here. Which
 * property lies in it is said on the page of the property, and who holds in
 * it under "Zugänge"; this screen shows both and changes neither, except
 * where an area goes: its properties move to another one first, in the same
 * step (ADR 0003).
 */

/** An area as the overview lists it: what lies in it, and who it is named for. */
export interface AreaEntry extends Area {
  /** The properties in it, by name. */
  readonly properties: readonly { readonly id: string; readonly name: string }[]
  /** How many buildings stand on them. */
  readonly buildings: number
  /** Who it is named for, of those who can work. Whoever holds in every area is not among them. */
  readonly members: readonly { readonly userId: string; readonly name: string }[]
}

export const areaOverviewQuery = {
  queryKey: ['area-overview'],
  queryFn: () => request<AreaEntry[]>('/areas/overview'),
} as const

export const areaScreenWords = {
  title: 'Bereiche',
  what: 'Welche Liegenschaften zusammengehören, und wer sie sieht.',
  caption: 'Bereiche dieses Betreibers',
  add: 'Bereich anlegen',
  rename: 'Umbenennen',
  remove: 'Entfernen',
  moveAndRemove: 'Verlegen und entfernen',
  rule:
    'Leitung und Technische Leitung sehen alle Bereiche. Eine Liegenschaft gehört zu genau einem ' +
    'Bereich. Entfernen lässt sich ein Bereich erst, wenn keine Liegenschaft mehr in ihm liegt.',
  noProperty: 'keine',
  nobody: 'niemand',
  moving:
    'Eine Liegenschaft wechselt den Bereich über ihre Seite, „Bearbeiten“. Alles an ihr wechselt ' +
    'mit: Gebäude, Räume, Anlagen, Pflichten und Vorgänge. Wer den Bereich nicht hat, sieht sie ' +
    'danach nicht mehr.',
  onlyOne:
    'Ein kleiner Betreiber hat einen einzigen Bereich und merkt nichts davon; der erste heißt ' +
    '„Alle Liegenschaften“.',
  enforced:
    'Durchgesetzt wird der Bereich in der Datenbank, nicht in jeder Abfrage: eine Zeile mit ' +
    'Ortsbezug trägt ihren Bereich, und nur die Bereiche der Anfrage kommen durch.',
  whatAnAreaIs: 'Ein Bereich fasst Liegenschaften zusammen, die dieselben Leute sehen.',
  newOne:
    'Den neuen Bereich hat zunächst niemand außer Leitung und Technischer Leitung. Wer ihn ' +
    'bekommt, steht unter „Zugänge“; welche Liegenschaft in ihm liegt, auf ihrer Seite.',
  renamed:
    'Der Name steht überall, wo eine Liegenschaft ihren Bereich nennt. Wer den Bereich hat, ' +
    'behält ihn.',
  emptyFirst: 'Ein Bereich lässt sich erst entfernen, wenn keine Liegenschaft mehr in ihm liegt.',
  moveTo: 'Verlegen nach',
  whereTo: 'Bitte wählen, wohin die Liegenschaften verlegt werden.',
  whoeverHoldsOnlyThis:
    'Wer nur diesen Bereich hat, hat danach keinen mehr und sieht nichts mit Ortsbezug, bis unter ' +
    '„Zugänge“ ein Bereich gegeben wird. Gesperrt wird niemand.',
  notListed: 'Die Bereiche kamen nicht an.',
  notMade: 'Der Bereich ließ sich nicht anlegen.',
  notRenamed: 'Der Bereich ließ sich nicht umbenennen.',
  notRemoved: 'Der Bereich ließ sich nicht entfernen.',
} as const

const choose = { value: '', label: 'Bitte wählen' } as const

/** How many properties a line of the table names before it counts the rest. */
const namedInTheTable = 5
/** How many the question before a removal names. */
const namedInTheQuestion = 3

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** "7 Liegenschaften, 12 Gebäude" under the name of an area, or that nothing lies in it. */
export function whatLiesIn(area: Pick<AreaEntry, 'properties' | 'buildings'>): string {
  const properties = area.properties.length

  if (properties === 0) {
    return 'keine Liegenschaft'
  }

  const buildings =
    area.buildings === 0
      ? 'kein Gebäude'
      : area.buildings === 1
        ? '1 Gebäude'
        : `${String(area.buildings)} Gebäude`

  return `${properties === 1 ? '1 Liegenschaft' : `${String(properties)} Liegenschaften`}, ${buildings}`
}

/** The first names of a list and how many more there are: "A", "B", "2 weitere". */
export function firstOf(names: readonly string[], most: number): string[] {
  const more = names.length - most

  return more > 0 ? [...names.slice(0, most), `${String(more)} weitere`] : [...names]
}

/** Names as a sentence lists them: "A", "A und B", "A, B und C". */
export function inASentence(names: readonly string[]): string {
  const last = names.at(-1)

  if (last === undefined) {
    return ''
  }

  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} und ${last}`
}

/** What still lies in an area that is to go, and what happens to it first. */
export function whatMovesFirst(area: Pick<AreaEntry, 'name' | 'properties'>): string {
  const names = inASentence(
    firstOf(
      area.properties.map((property) => property.name),
      namedInTheQuestion,
    ),
  )

  return area.properties.length === 1
    ? `In „${area.name}“ liegt noch 1 Liegenschaft: ${names}. Sie wird vorher in einen anderen ` +
        'Bereich verlegt, mit allem, was an ihr hängt: Gebäude, Räume, Anlagen, Pflichten und Vorgänge.'
    : `In „${area.name}“ liegen noch ${String(area.properties.length)} Liegenschaften: ${names}. ` +
        'Sie werden vorher in einen anderen Bereich verlegt, mit allem, was an ihnen hängt: ' +
        'Gebäude, Räume, Anlagen, Pflichten und Vorgänge.'
}

/**
 * Who holds in no area once this one is gone: of the people it is named for,
 * those who hold in it alone. Null where the areas of the people are not
 * known, which takes the right to see who works for the tenant.
 */
export function leftWithoutAny(
  area: Pick<AreaEntry, 'id' | 'members'>,
  held: readonly MemberAreas[] | undefined,
): string[] | null {
  if (held === undefined) {
    return null
  }

  return area.members
    .filter((person) => {
      const theirs = held.find((entry) => entry.userId === person.userId)

      return theirs !== undefined && !theirs.all && theirs.areaIds.every((id) => id === area.id)
    })
    .map((person) => person.name)
}

/** What the removal means for them, said before it happens, or null where it leaves nobody without an area. */
export function whoIsLeft(names: readonly string[] | null): string | null {
  if (names === null) {
    return areaScreenWords.whoeverHoldsOnlyThis
  }

  const [only, ...more] = names

  if (only === undefined) {
    return null
  }

  return more.length === 0
    ? `${only} hat danach keinen Bereich mehr und sieht nichts mit Ortsbezug, bis unter ` +
        '„Zugänge“ ein Bereich gegeben wird. Gesperrt wird niemand.'
    : `${inASentence(names)} haben danach keinen Bereich mehr. Sie sehen nichts mit Ortsbezug, ` +
        'bis ihnen unter „Zugänge“ ein Bereich gegeben wird. Gesperrt wird niemand.'
}

/** The question before an area goes that nothing lies in. */
export function nothingLiesIn(name: string, left: readonly string[] | null): string {
  return left !== null && left.length === 0
    ? `In „${name}“ liegt keine Liegenschaft, und niemand hat nur diesen Bereich. Wer ihn hat, ` +
        'hat danach einen Bereich weniger.'
    : `In „${name}“ liegt keine Liegenschaft.`
}

type Open =
  | { readonly kind: 'new' }
  | { readonly kind: 'rename'; readonly area: AreaEntry }
  | { readonly kind: 'remove'; readonly area: AreaEntry }

export function AreasScreen() {
  const queries = useQueryClient()
  const client = useSync()
  // Reading the areas takes one right and keeping them another. Without the
  // second nothing is offered that the routes would refuse.
  const mayWrite = useRight('settings.write')
  // Who holds in which area belongs to who works for the tenant. Without that
  // right the question before a removal names nobody.
  const seesStaff = useRight('membership.read')
  const overview = useQuery(areaOverviewQuery)
  const held = useQuery({ ...memberAreasQuery, enabled: seesStaff })
  const [open, setOpen] = useState<Open | null>(null)

  /**
   * After a change everything that names an area is asked again: this list,
   * the areas every other screen filters by, and who holds in which. Where
   * properties moved, the exchange brings them down with their new area.
   */
  function changed(moved: boolean) {
    setOpen(null)
    void queries.invalidateQueries({ queryKey: areaOverviewQuery.queryKey })
    void queries.invalidateQueries({ queryKey: areasQuery.queryKey })
    void queries.invalidateQueries({ queryKey: memberAreasQuery.queryKey })

    if (moved) {
      void client.synchronise()
    }
  }

  const areas = overview.data ?? []
  // A tenant keeps one area: every property lies in one.
  const mayRemove = areas.length > 1

  const add = mayWrite ? (
    <Button
      size="small"
      icon={Plus}
      disabled={open !== null || overview.data === undefined}
      onClick={() => {
        setOpen({ kind: 'new' })
      }}
    >
      {areaScreenWords.add}
    </Button>
  ) : null

  function actionsOf(area: AreaEntry) {
    if (!mayWrite) {
      return null
    }

    return (
      <span className="inline-flex flex-wrap justify-end gap-1.5">
        <Button
          size="small"
          aria-label={`Bereich ${area.name} umbenennen`}
          onClick={() => {
            setOpen({ kind: 'rename', area })
          }}
        >
          {areaScreenWords.rename}
        </Button>
        {mayRemove ? (
          <Button
            size="small"
            tone="danger"
            aria-label={`Bereich ${area.name} entfernen`}
            onClick={() => {
              setOpen({ kind: 'remove', area })
            }}
          >
            {areaScreenWords.remove}
          </Button>
        ) : null}
      </span>
    )
  }

  const propertiesOf = (area: AreaEntry): ReactNode =>
    area.properties.length === 0 ? (
      <span className="text-ink-faint">{areaScreenWords.noProperty}</span>
    ) : (
      firstOf(
        area.properties.map((property) => property.name),
        namedInTheTable,
      ).join(', ')
    )

  const membersOf = (area: AreaEntry): ReactNode =>
    area.members.length === 0 ? (
      <span className="text-ink-faint">{areaScreenWords.nobody}</span>
    ) : (
      area.members.map((person) => person.name).join(', ')
    )

  const cards: readonly TableCard[] = areas.map((area) => ({
    key: area.id,
    title: area.name,
    sub: (
      <>
        {whatLiesIn(area)}
        {area.properties.length === 0 ? null : (
          <span className="mt-0.5 block">{propertiesOf(area)}</span>
        )}
        <span className="mt-0.5 block">Zugänge: {membersOf(area)}</span>
      </>
    ),
    actions: actionsOf(area),
  }))

  return (
    <SettingsPage active="bereiche" title={areaScreenWords.title} sub={areaScreenWords.what}>
      {overview.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : overview.isError ? (
        <SettingsText muted>{saidWhy(overview.error, areaScreenWords.notListed)}</SettingsText>
      ) : (
        <TablePanel
          title={areaScreenWords.title}
          caption={areaScreenWords.caption}
          action={add}
          cards={cards}
          note={areaScreenWords.rule}
        >
          <thead>
            <tr>
              <Column className="w-[170px]">Bereich</Column>
              <Column>Liegenschaften</Column>
              <Column className="w-[190px]">Zugänge mit diesem Bereich</Column>
              <Column numeric className="w-[196px]">
                <span className="sr-only">Ändern</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area.id}>
                <Cell>
                  <span className="block text-[14px] font-medium">{area.name}</span>
                  <span className="block text-[12px] text-ink-faint">{whatLiesIn(area)}</span>
                </Cell>
                <Cell className="text-[13px] leading-[1.5]">{propertiesOf(area)}</Cell>
                <Cell className="text-[13px] leading-[1.5]">{membersOf(area)}</Cell>
                <Cell numeric>{actionsOf(area)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Liegenschaft verschieben">
          <div className="flex flex-col gap-2">
            <SettingsText small>{areaScreenWords.moving}</SettingsText>
            <p className="text-[12px] leading-[1.5] text-ink-muted">{areaScreenWords.onlyOne}</p>
          </div>
        </Panel>
        <Panel title="Wie der Bereich wirkt">
          <p className="text-[12px] leading-[1.5] text-ink-muted">{areaScreenWords.enforced}</p>
        </Panel>
      </div>

      {open?.kind === 'new' ? (
        <AreaName
          area={null}
          onDone={() => {
            changed(false)
          }}
          onClose={() => {
            setOpen(null)
          }}
        />
      ) : null}

      {open?.kind === 'rename' ? (
        <AreaName
          key={open.area.id}
          area={open.area}
          onDone={() => {
            changed(false)
          }}
          onClose={() => {
            setOpen(null)
          }}
        />
      ) : null}

      {open?.kind === 'remove' ? (
        <RemoveArea
          key={open.area.id}
          area={open.area}
          others={areas.filter((area) => area.id !== open.area.id)}
          left={leftWithoutAny(open.area, held.data)}
          onDone={changed}
          onClose={() => {
            setOpen(null)
          }}
        />
      ) : null}
    </SettingsPage>
  )
}

/**
 * The name of an area, for a new one and for one that is there. What the
 * model refuses is said before anything is sent; that the tenant has an area
 * of that name already only the server knows, and its sentence stands under
 * the field. A name left as it was sends nothing.
 */
function AreaName({
  area,
  onDone,
  onClose,
}: {
  /** The area to rename, or null for a new one. */
  readonly area: AreaEntry | null
  readonly onDone: () => void
  readonly onClose: () => void
}) {
  const [name, setName] = useState(area?.name ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function submit() {
    const refused = areaNameProblem(name)

    if (refused !== null) {
      setProblem(refused)

      return
    }

    const wanted = name.trim()

    if (area !== null && wanted === area.name) {
      onClose()

      return
    }

    setWorking(true)
    setProblem(null)

    try {
      await request(area === null ? '/areas' : `/areas/${encodeURIComponent(area.id)}`, {
        method: area === null ? 'POST' : 'PATCH',
        body: JSON.stringify({ name: wanted }),
      })
      onDone()
    } catch (error) {
      setProblem(
        saidWhy(error, area === null ? areaScreenWords.notMade : areaScreenWords.notRenamed),
      )
      setWorking(false)
    }
  }

  const doing = area === null ? areaScreenWords.add : areaScreenWords.rename

  return (
    <Dialog
      title={area === null ? areaScreenWords.add : `Bereich „${area.name}“ umbenennen`}
      width={520}
      onClose={onClose}
      {...(area === null ? { sub: areaScreenWords.whatAnAreaIs } : {})}
    >
      <form
        className="flex flex-col gap-2.5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field
          label="Name"
          starred
          autoFocus
          maxLength={areaNameMaxLength}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          {...(problem === null ? {} : { problem })}
        />
        <p className="text-[12px] leading-[1.5] text-ink-muted">
          {area === null ? areaScreenWords.newOne : areaScreenWords.renamed}
        </p>

        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Einen Moment' : doing}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * The question before an area goes. What lies in it moves to another area
 * first, in the same step, and the question says where to; an area nothing
 * lies in goes as it is.
 *
 * The list shows the properties a person works with. One marked as removed
 * still names its area, and only the server knows of it: it refuses the
 * removal with its sentence, and the question then asks where to as well.
 */
function RemoveArea({
  area,
  others,
  left,
  onDone,
  onClose,
}: {
  readonly area: AreaEntry
  /** The areas the properties can move to. */
  readonly others: readonly Area[]
  /** Who holds in no area afterwards, or null where that is not known. */
  readonly left: readonly string[] | null
  readonly onDone: (moved: boolean) => void
  readonly onClose: () => void
}) {
  const [only, ...more] = others
  // With one other area there is nothing to choose.
  const [target, setTarget] = useState(only !== undefined && more.length === 0 ? only.id : '')
  // What the server said about properties the list does not show.
  const [heldByRemoved, setHeldByRemoved] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const moves = area.properties.length > 0 || heldByRemoved !== null
  const afterwards = whoIsLeft(left)

  async function submit() {
    if (moves && target === '') {
      setTrouble(areaScreenWords.whereTo)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const answer = await request<{ readonly moved: number }>(
        `/areas/${encodeURIComponent(area.id)}${moves ? `?moveTo=${encodeURIComponent(target)}` : ''}`,
        { method: 'DELETE' },
      )

      onDone(answer.moved > 0)
    } catch (error) {
      setWorking(false)

      if (!moves && error instanceof RequestRefused && error.status === 409) {
        setHeldByRemoved(error.message)
      } else {
        setTrouble(saidWhy(error, areaScreenWords.notRemoved))
      }
    }
  }

  return (
    <Dialog
      title={`Bereich „${area.name}“ entfernen?`}
      width={600}
      onClose={onClose}
      {...(moves ? { sub: areaScreenWords.emptyFirst } : {})}
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <SettingsText>
          {heldByRemoved ??
            (area.properties.length > 0 ? whatMovesFirst(area) : nothingLiesIn(area.name, left))}
        </SettingsText>
        {moves ? (
          <SelectField
            label={areaScreenWords.moveTo}
            value={target}
            options={[
              ...(more.length === 0 ? [] : [choose]),
              ...others.map((other) => ({ value: other.id, label: other.name })),
            ]}
            onChange={setTarget}
          />
        ) : null}
        {afterwards === null ? null : <NoteBox tone="waiting">{afterwards}</NoteBox>}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="danger" disabled={working}>
            {working
              ? 'Einen Moment'
              : moves
                ? areaScreenWords.moveAndRemove
                : areaScreenWords.remove}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
