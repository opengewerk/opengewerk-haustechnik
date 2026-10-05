import {
  type Area,
  type MemberAreas,
  newSubstitutionProblem,
  type Substitution,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  type TableCard,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { NoteBox, SettingsText } from '@opengewerk/platform-web/office'
import { staff, type StaffEntry, staffRoles, useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { useState } from 'react'

import { areasQuery } from '../session/areas.js'
import { memberAreasQuery } from './staff-areas.js'

/**
 * The substitutions of a tenant (section 2.8 of the concept), as the card
 * between the accounts and the invitations on "Zugänge" (the boards
 * `zugaenge` and `vertretung`): for a stretch of days somebody takes over the
 * areas of somebody else.
 *
 * Listed is what runs or is still to come; one that has ended does nothing
 * any more, and the change log keeps it. Entered and ended by whoever decides
 * who works for the tenant, at the routes under `/substitutions`. None is
 * changed: one with the wrong days is ended and entered again.
 */

/** A substitution as the list of them names it. */
export interface SubstitutionEntry extends Substitution {
  readonly id: string
}

export const substitutionsQuery = {
  queryKey: ['substitutions'],
  queryFn: () => request<SubstitutionEntry[]>('/substitutions'),
} as const

export const substitutionWords = {
  title: 'Vertretungen',
  add: 'Vertretung anlegen',
  what: 'Befristet übernimmt jemand die Bereiche einer anderen Person.',
  none: 'Gerade vertritt niemand jemanden, und es steht keine Vertretung an.',
  days: 'Die Tage zählen in deutscher Zeit; wer gesperrt ist, vertritt niemanden.',
  notListed: 'Die Vertretungen kamen nicht an.',
  notEntered: 'Die Vertretung ließ sich nicht anlegen.',
  notEnded: 'Die Vertretung ließ sich nicht beenden.',
  unknown: 'Unbekanntes Konto',
} as const

const choose = { value: '', label: 'Bitte wählen' } as const

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** The days of a substitution as a person reads them: one day, or from a day to a day. */
function periodOf(entry: Pick<Substitution, 'startsOn' | 'endsOn'>): string {
  const first = date(entry.startsOn)
  const last = date(entry.endsOn)

  return first === last ? first : `${first} bis ${last}`
}

/** The names of the areas somebody holds in, in the order the tenant lists them. */
function namesOf(held: MemberAreas, areas: readonly Area[]): string[] {
  return areas.filter((area) => held.areaIds.includes(area.id)).map((area) => area.name)
}

/**
 * What a substitution adds for whoever stands in: the areas of the absent
 * person they do not hold themselves. Nothing for somebody who holds in every
 * area already.
 */
export function areasOnTop(
  substitute: MemberAreas | undefined,
  absent: MemberAreas | undefined,
  areas: readonly Area[],
): string {
  if (!substitute || !absent) {
    return ''
  }

  if (substitute.all) {
    return 'keine'
  }

  if (absent.all) {
    return 'alle'
  }

  const names = namesOf(absent, areas).filter((name) => !namesOf(substitute, areas).includes(name))

  return names.length === 0 ? 'keine' : names.join(', ')
}

/**
 * What a substitution will mean, said before it is entered, with the same
 * areas the list names afterwards: the ones that come on top, or that none
 * does.
 */
export function whatItAdds(
  substitute: string,
  absent: string,
  days: string,
  onTop: string,
): string {
  return onTop === 'keine' || onTop === ''
    ? `${substitute} sieht ${days} nichts zusätzlich: von ${absent} kommt kein Bereich dazu.`
    : `${substitute} sieht ${days} zusätzlich die Bereiche von ${absent}: ${onTop}.`
}

export function Substitutions() {
  const queries = useQueryClient()
  // Reading the list takes one right and changing it another. Without the
  // second nothing is offered that the routes would refuse.
  const mayWrite = useRight('membership.write')
  const list = useQuery(substitutionsQuery)
  const people = useQuery({ queryKey: ['staff'], queryFn: staff })
  const roles = useQuery({ queryKey: ['staff-roles'], queryFn: staffRoles })
  const members = useQuery(memberAreasQuery)
  const areas = useQuery(areasQuery)
  const [adding, setAdding] = useState(false)
  // Ending asks first: it takes away what somebody sees.
  const [ending, setEnding] = useState<SubstitutionEntry | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  const end = useMutation({
    mutationFn: (id: string) =>
      request(`/substitutions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setEnding(null)
      void queries.invalidateQueries({ queryKey: substitutionsQuery.queryKey })
    },
    onError: (error) => {
      setEnding(null)
      setTrouble(saidWhy(error, substitutionWords.notEnded))
    },
  })

  if (list.isPending) {
    return null
  }

  const named = areas.data ?? []
  const nameOf = (userId: string) =>
    people.data?.find((person) => person.userId === userId)?.name ?? substitutionWords.unknown
  const areasOf = (userId: string) => members.data?.find((entry) => entry.userId === userId)
  const onTop = (entry: SubstitutionEntry) =>
    areasOnTop(areasOf(entry.substitute), areasOf(entry.absent), named)
  // A dialog names people, their roles and their areas: not before all of
  // them are known.
  const known =
    people.data && roles.data && members.data && areas.data
      ? { people: people.data, roles: roles.data, members: members.data, areas: areas.data }
      : null

  const action = mayWrite ? (
    <Button
      size="small"
      icon={Plus}
      disabled={adding || known === null}
      onClick={() => {
        setTrouble(null)
        setAdding(true)
      }}
    >
      {substitutionWords.add}
    </Button>
  ) : null

  function endButton(entry: SubstitutionEntry) {
    if (!mayWrite) {
      return null
    }

    return (
      <Button
        size="small"
        aria-label={`Vertretung von ${nameOf(entry.substitute)} für ${nameOf(entry.absent)} beenden`}
        disabled={end.isPending}
        onClick={() => {
          setTrouble(null)
          setEnding(entry)
        }}
      >
        Beenden
      </Button>
    )
  }

  const entries = list.data ?? []

  const cards: readonly TableCard[] = entries.map((entry) => ({
    key: entry.id,
    title: `${nameOf(entry.substitute)} für ${nameOf(entry.absent)}`,
    sub: (
      <>
        {periodOf(entry)}
        <span className="mt-0.5 block">Bereiche dazu: {onTop(entry)}</span>
      </>
    ),
    actions: endButton(entry),
  }))

  return (
    <>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {list.isError ? (
        <Panel title={substitutionWords.title}>
          <SettingsText muted>{saidWhy(list.error, substitutionWords.notListed)}</SettingsText>
        </Panel>
      ) : entries.length === 0 ? (
        <Panel title={substitutionWords.title} action={action}>
          <SettingsText muted>{substitutionWords.none}</SettingsText>
        </Panel>
      ) : (
        <TablePanel
          title={substitutionWords.title}
          caption="Vertretungen, die laufen oder anstehen"
          action={action}
          cards={cards}
        >
          <thead>
            <tr>
              <Column>Wer</Column>
              <Column className="w-[170px]">Für wen</Column>
              <Column className="w-[124px]">Bereiche dazu</Column>
              <Column className="w-[190px]">Zeitraum</Column>
              <Column numeric className="w-[100px]">
                <span className="sr-only">Beenden</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <Cell className="text-[13px]">{nameOf(entry.substitute)}</Cell>
                <Cell className="text-[13px]">{nameOf(entry.absent)}</Cell>
                <Cell className="text-[13px]">{onTop(entry)}</Cell>
                <Cell className="text-[13px]">{periodOf(entry)}</Cell>
                <Cell numeric>{endButton(entry)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

      {adding && known ? (
        <NewSubstitution
          people={known.people}
          labelOf={(key) => known.roles.find((role) => role.key === key)?.label ?? key}
          members={known.members}
          areas={known.areas}
          onDone={() => {
            setAdding(false)
            void queries.invalidateQueries({ queryKey: substitutionsQuery.queryKey })
          }}
          onClose={() => {
            setAdding(false)
          }}
        />
      ) : null}

      <Confirm
        open={ending !== null}
        title="Vertretung beenden?"
        confirm="Beenden"
        busy={end.isPending}
        onConfirm={() => {
          if (ending) {
            end.mutate(ending.id)
          }
        }}
        onCancel={() => {
          setEnding(null)
        }}
      >
        {ending
          ? `${nameOf(ending.substitute)} sieht die Bereiche von ${nameOf(ending.absent)} danach nicht mehr, soweit es nicht die eigenen sind. Eine neue Vertretung geht jederzeit.`
          : ''}
      </Confirm>
    </>
  )
}

/**
 * Who stands in for whom, from which day to which. What the rules of the
 * model refuse is said before anything is sent; what only the server knows,
 * two people who already stand in for each other on those days, comes back
 * as its sentence.
 */
function NewSubstitution({
  people,
  labelOf,
  members,
  areas,
  onDone,
  onClose,
}: {
  readonly people: readonly StaffEntry[]
  /** What the tenant calls a role, by its key. */
  readonly labelOf: (role: string) => string
  readonly members: readonly MemberAreas[]
  readonly areas: readonly Area[]
  readonly onDone: () => void
  readonly onClose: () => void
}) {
  const [substitute, setSubstitute] = useState('')
  const [absent, setAbsent] = useState('')
  const [startsOn, setStartsOn] = useState(() => today())
  const [endsOn, setEndsOn] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const areasOf = (userId: string) => members.find((entry) => entry.userId === userId)

  /** "Petra Lindner, Objektleitung Nord": a person with the role and the areas named for them. */
  function option(person: StaffEntry) {
    const held = areasOf(person.userId)
    const named = held && !held.all ? namesOf(held, areas) : []
    const role = person.roles.map(labelOf).join(', ')
    const where = named.length === 0 ? '' : ` ${named.join(', ')}`

    return { value: person.userId, label: `${person.name}, ${role}${where}` }
  }

  // Somebody who is shut out sees nothing and stands in for nobody. The
  // absent person may be shut out: somebody leaves, and the substitution
  // takes over.
  const whoCanWork = people.filter((person) => person.blockedAt === null)
  const chosen = people.find((person) => person.userId === substitute)
  const away = people.find((person) => person.userId === absent)
  const said =
    chosen && away && startsOn !== '' && endsOn !== ''
      ? `${whatItAdds(
          chosen.name,
          away.name,
          startsOn === endsOn
            ? `am ${date(startsOn)}`
            : `vom ${date(startsOn)} bis zum ${date(endsOn)}`,
          areasOnTop(areasOf(substitute), areasOf(absent), areas),
        )} `
      : ''

  async function submit() {
    const wanted = { substitute, absent, startsOn, endsOn }
    const problem = newSubstitutionProblem(wanted, today())

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      await request('/substitutions', { method: 'POST', body: JSON.stringify(wanted) })
      onDone()
    } catch (error) {
      setTrouble(saidWhy(error, substitutionWords.notEntered))
      setWorking(false)
    }
  }

  return (
    <Dialog
      title={substitutionWords.add}
      sub={substitutionWords.what}
      width={600}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Wer vertritt"
            value={substitute}
            options={[choose, ...whoCanWork.map(option)]}
            onChange={setSubstitute}
          />
          <SelectField
            label="Für wen"
            value={absent}
            options={[choose, ...people.map(option)]}
            onChange={setAbsent}
          />
          <Field
            label="Anfang"
            type="date"
            value={startsOn}
            onChange={(event) => {
              setStartsOn(event.target.value)
            }}
          />
          <Field
            label="Ende"
            type="date"
            value={endsOn}
            onChange={(event) => {
              setEndsOn(event.target.value)
            }}
          />
        </div>
        <NoteBox>
          {said}
          {substitutionWords.days}
        </NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Einen Moment' : substitutionWords.add}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
