import {
  impliedBy,
  leadingRights,
  offerableRights,
  ownRoleProblems,
  ownRoleWords,
  type Right,
  rightGroups,
  rightLabel,
  rights,
  type RoleEntry,
  withImplied,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Field,
  Panel,
  SelectField,
  Status,
  TablePanel,
} from '@opengewerk/platform-web'
import { NoteBox, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Check, Info, Lock, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'

/**
 * "Einstellungen", "Rollen" (section 7 of the concept, #346, the boards
 * `rollen`, `rolle`, `rolle_mitgeliefert`): the roles of the tenant, the
 * shipped ones as they stay and those it made for itself, with what each
 * may do and how many hold it. Whoever looks at the accesses reads it, the
 * Leitung; whoever keeps them makes, changes and removes a role of the
 * tenant's own, the Leitung again. From the server, with a connection.
 */

export const rolesWords = {
  title: 'Rollen',
  sub: 'Was jede Rolle darf, und Rollen, die dieser Betreiber selbst zuschneidet.',
  caption:
    'Rollen dieses Betreibers mit ihren Rechten, wie vielen Zugängen jede zugeordnet ist und ob sie einen zweiten Faktor verlangt',
  note: 'Eine mitgelieferte Rolle bleibt, wie sie ist; eine eigene kann von ihr ausgehen. Eine Rolle, die noch einem Zugang oder einer offenen Einladung zugeordnet ist, wird nicht entfernt. Eine Änderung gilt beim nächsten Aufruf jeder Person mit dieser Rolle.',
  shipped: 'mitgeliefert',
  own: 'eigene',
  leads: 'führt den Betreiber',
  required: 'Pflicht',
  make: 'Rolle anlegen',
  look: 'Ansehen',
  edit: 'Bearbeiten',
  remove: 'Entfernen',
  loading: 'Wird geladen.',
  failed: 'Die Rollen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  newRights: (role: string, words: readonly string[]) =>
    `Seit der letzten Änderung von „${role}“ ${words.length === 1 ? 'kam ein Recht' : 'kamen Rechte'} dazu, das eine eigene Rolle nicht von selbst bekommt: ${words.join(', ')}.`,
  newChip: (count: number) => (count === 1 ? '1 neues Recht' : `${String(count)} neue Rechte`),
  count: (held: number) => `${String(held)} von ${String(offerableRights.length)}`,
  all: (held: number) => `alle ${String(held)}`,
  removeQuestion: (role: string) => `Rolle „${role}“ entfernen?`,
  removeWhat:
    'Die Rolle ist keinem Zugang und keiner offenen Einladung zugeordnet. Was sie durfte, bleibt im Änderungsprotokoll.',
} as const

export const roleFormWords = {
  newTitle: 'Neue Rolle',
  newSub: 'Eigene Rolle dieses Betreibers',
  ownSub: (held: number, holders: number) =>
    `Eigene Rolle, ${String(held)} von ${String(offerableRights.length)} Rechten, ${holders === 1 ? '1 Zugang' : `${String(holders)} Zugängen`} zugeordnet`,
  shippedSub: (held: number, holders: number) =>
    `Mitgelieferte Rolle, ${String(held)} von ${String(offerableRights.length)} Rechten, ${holders === 1 ? '1 Zugang' : `${String(holders)} Zugängen`} zugeordnet`,
  label: 'Bezeichnung',
  labelHint: 'etwa Hausmeisterei',
  from: 'Ausgehend von',
  fromHint:
    'Übernimmt die Rechte dieser Rolle, soweit eine eigene sie bekommen kann. Danach hängt nichts mehr an ihr.',
  fromNone: 'Keiner, ohne Rechte',
  secondFactor: 'Zweiter Faktor Pflicht',
  secondFactorHint: 'Wer diese Rolle hat, meldet sich nur mit zweitem Faktor an.',
  together:
    'Wer ändern darf, sieht auch: das Recht zum Ansehen kommt mit und lässt sich nicht abwählen. Eine Änderung gilt beim nächsten Aufruf jeder Person mit dieser Rolle.',
  comesWith: (right: Right) => `kommt mit „${rightLabel[right]}“`,
  fresh: 'neu',
  reserved: 'Bleibt der Leitung',
  reservedWhy:
    'Diese Rechte hat nur die Leitung. Wer Zugänge verwaltet, könnte sich selbst die Leitung geben; das Änderungsprotokoll sieht nur die Leitung (Abschnitt 9).',
  inUse: (holders: number, invited: number) =>
    `Entfernen geht, sobald die Rolle keinem Zugang und keiner offenen Einladung mehr zugeordnet ist. Sie ist ${[
      holders === 0 ? null : holders === 1 ? '1 Zugang' : `${String(holders)} Zugängen`,
      invited === 0
        ? null
        : invited === 1
          ? '1 offenen Einladung'
          : `${String(invited)} offenen Einladungen`,
    ]
      .filter(Boolean)
      .join(' und ')} zugeordnet.`,
  shippedStays: ownRoleWords.shippedStays,
  copy: 'Als eigene Rolle anlegen',
  create: 'Anlegen',
  save: 'Speichern',
  cancel: 'Abbrechen',
  saved: 'Gespeichert.',
  offline: 'Ohne Verbindung zum Server lässt sich keine Rolle ändern.',
  notThere: ownRoleWords.missing,
} as const

const rolesQuery = {
  queryKey: ['roles'],
  queryFn: () => request<readonly RoleEntry[]>('/roles'),
} as const

/** Where the roles live, and a role by its key. */
export const rolePlaces = {
  list: '/einstellungen/rollen',
  fresh: '/einstellungen/rollen/neu',
  role: (key: string) => `/einstellungen/rollen/${encodeURIComponent(key)}`,
} as const

/** The roles, and after a change the accesses, whose dialogs offer the roles too. */
function useRolesChanged(): () => Promise<void> {
  const queries = useQueryClient()

  return async () => {
    await queries.invalidateQueries({ queryKey: ['roles'] })
    await queries.invalidateQueries({ queryKey: ['staff-roles'] })
  }
}

/** How many of the rights a role holds, as the list says it: all of them for the role that leads. */
function heldWords(role: RoleEntry): string {
  return role.leads ? rolesWords.all(rights.length) : rolesWords.count(offeredHeld(role).length)
}

/** The rights a role holds that a role of the tenant's own could hold. */
function offeredHeld(role: Pick<RoleEntry, 'rights'>): Right[] {
  return offerableRights.filter((right) => role.rights.includes(right))
}

export function RolesScreen() {
  const roles = useQuery({
    ...rolesQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const keeps = useRight('membership.write')
  const navigate = useNavigate()
  const changed = useRolesChanged()
  const [removing, setRemoving] = useState<RoleEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const fresh = (roles.data ?? []).filter((role) => role.newRights.length > 0)

  return (
    <SettingsPage
      active="rollen"
      title={rolesWords.title}
      sub={rolesWords.sub}
      actions={
        keeps ? (
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              void navigate({ to: rolePlaces.fresh })
            }}
          >
            {rolesWords.make}
          </Button>
        ) : null
      }
    >
      {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
      {/* A right a later version brought reaches a role of the tenant's own not by itself (section 7). */}
      {fresh.map((role) => (
        <NoteBox
          key={role.key}
          tone="waiting"
          action={
            <Link to={rolePlaces.role(role.key)} className="underline">
              {rolesWords.look}
            </Link>
          }
        >
          {rolesWords.newRights(
            role.label,
            role.newRights.map((right) => rightLabel[right]),
          )}
        </NoteBox>
      ))}
      {roles.data === undefined ? (
        <SettingsText muted>{roles.isError ? rolesWords.failed : rolesWords.loading}</SettingsText>
      ) : (
        <TablePanel
          title="Rollen dieses Betreibers"
          caption={rolesWords.caption}
          note={rolesWords.note}
          grow={false}
          cards={roles.data.map((role) => ({
            key: role.key,
            title: (
              <Link to={rolePlaces.role(role.key)} className="font-semibold">
                {role.label}
              </Link>
            ),
            sub: [
              role.shipped ? rolesWords.shipped : rolesWords.own,
              heldWords(role),
              `${String(role.holders)} Zugänge`,
            ].join(' · '),
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[180px]">Rolle</Column>
              <Column className="w-[130px] min-w-[120px]">Art</Column>
              <Column className="w-[160px] min-w-[140px]">Rechte</Column>
              <Column className="w-[90px] min-w-[80px] text-right">Zugänge</Column>
              <Column className="w-[130px] min-w-[110px]">Zweiter Faktor</Column>
              <Column className="w-[200px] min-w-[180px]">
                <span className="sr-only">Was sich mit der Rolle tun lässt</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {roles.data.map((role) => (
              <tr key={role.key}>
                <Cell>
                  <Link to={rolePlaces.role(role.key)} className="font-semibold">
                    {role.label}
                  </Link>
                  {role.leads ? (
                    <span className="block text-[12px] text-ink-muted">{rolesWords.leads}</span>
                  ) : null}
                </Cell>
                <Cell>
                  {role.shipped ? (
                    <Status tone="neutral">{rolesWords.shipped}</Status>
                  ) : (
                    <Status tone="done" icon={Pencil}>
                      {rolesWords.own}
                    </Status>
                  )}
                </Cell>
                <Cell>
                  <span className="numeric">{heldWords(role)}</span>
                  {role.newRights.length === 0 ? null : (
                    <span className="mt-1 block">
                      <Status tone="waiting" icon={Info}>
                        {rolesWords.newChip(role.newRights.length)}
                      </Status>
                    </span>
                  )}
                </Cell>
                <Cell className="numeric text-right">{role.holders}</Cell>
                <Cell>{role.secondFactor ? rolesWords.required : null}</Cell>
                <Cell>
                  <span className="flex justify-end gap-1.5">
                    <Button
                      size="small"
                      onClick={() => {
                        void navigate({ to: rolePlaces.role(role.key) })
                      }}
                    >
                      {role.shipped || !keeps ? rolesWords.look : rolesWords.edit}
                    </Button>
                    {!role.shipped && keeps && role.holders === 0 && role.invited === 0 ? (
                      <Button
                        size="small"
                        tone="danger"
                        onClick={() => {
                          setRemoving(role)
                        }}
                      >
                        {rolesWords.remove}
                      </Button>
                    ) : null}
                  </span>
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <Confirm
        open={removing !== null}
        title={rolesWords.removeQuestion(removing?.label ?? '')}
        confirm={rolesWords.remove}
        busy={busy}
        onCancel={() => {
          setRemoving(null)
        }}
        onConfirm={() => {
          if (removing === null) {
            return
          }

          setBusy(true)
          setTrouble(null)
          request(`/roles/${encodeURIComponent(removing.key)}`, { method: 'DELETE' })
            .then(changed)
            .catch((error: unknown) => {
              setTrouble(error instanceof RequestRefused ? error.message : roleFormWords.offline)
            })
            .finally(() => {
              setBusy(false)
              setRemoving(null)
            })
        }}
      >
        {rolesWords.removeWhat}
      </Confirm>
    </SettingsPage>
  )
}

/**
 * A role by its key: one the application ships, as it stays, with the way to
 * a role of the tenant's own that starts from it; or one of the tenant's own,
 * with its label, whether it asks for a second factor and its rights by
 * group, for whoever keeps the accesses to change.
 */
export function RoleScreen() {
  const { roleKey } = useParams({ strict: false }) as { roleKey?: string }
  const roles = useQuery(rolesQuery)
  const role = roles.data?.find((each) => each.key === roleKey)

  if (role === undefined) {
    return (
      <SettingsPage active="rollen" title={rolesWords.title} sub={rolesWords.sub}>
        <SettingsText muted>
          {roles.data !== undefined
            ? roleFormWords.notThere
            : roles.isError
              ? rolesWords.failed
              : rolesWords.loading}
        </SettingsText>
      </SettingsPage>
    )
  }

  return role.shipped ? (
    <ShippedRole role={role} />
  ) : (
    <RoleForm role={role} roles={roles.data ?? []} />
  )
}

/** "Neue Rolle": a role of the tenant's own, starting from one the address names (`?von=`) or from none. */
export function NewRoleScreen() {
  const search = useSearch({ strict: false }) as { von?: string }
  const roles = useQuery(rolesQuery)

  if (roles.data === undefined) {
    return (
      <SettingsPage active="rollen" title={roleFormWords.newTitle} sub={roleFormWords.newSub}>
        <SettingsText muted>{roles.isError ? rolesWords.failed : rolesWords.loading}</SettingsText>
      </SettingsPage>
    )
  }

  return <RoleForm role={null} roles={roles.data} from={search.von ?? null} />
}

/** A shipped role as it stays: each right it holds and does not, by group, read only. */
function ShippedRole({ role }: { readonly role: RoleEntry }) {
  const keeps = useRight('membership.write')
  const navigate = useNavigate()

  return (
    <SettingsPage
      active="rollen"
      title={role.label}
      sub={roleFormWords.shippedSub(offeredHeld(role).length, role.holders)}
      actions={
        keeps ? (
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              void navigate({ to: rolePlaces.fresh, search: { von: role.key } })
            }}
          >
            {roleFormWords.copy}
          </Button>
        ) : null
      }
    >
      <NoteBox>{roleFormWords.shippedStays}</NoteBox>
      <div className="grid gap-3 lg:grid-cols-2">
        {rightGroups.map((group) => (
          <Panel key={group.title} title={group.title}>
            <ul aria-label={group.title} className="flex flex-col gap-1">
              {group.rights.map((right) => {
                const holds = role.rights.includes(right)

                return (
                  <li
                    key={right}
                    className={`flex items-center gap-2 text-[14px] leading-[1.4] ${holds ? '' : 'text-ink-faint'}`}
                  >
                    {holds ? (
                      <Check
                        size={14}
                        strokeWidth={2.6}
                        aria-hidden="true"
                        className="shrink-0 text-done"
                      />
                    ) : (
                      <X size={14} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
                    )}
                    {rightLabel[right]}
                    <span className="sr-only">{holds ? ': ja' : ': nein'}</span>
                  </li>
                )
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </SettingsPage>
  )
}

/** A new role of the tenant's own, or one to change: label, second factor and rights by group. */
function RoleForm({
  role,
  roles,
  from = null,
}: {
  readonly role: RoleEntry | null
  readonly roles: readonly RoleEntry[]
  readonly from?: string | null
}) {
  const keeps = useRight('membership.write')
  const navigate = useNavigate()
  const changed = useRolesChanged()
  const start = roles.find((each) => each.key === from) ?? null
  const [label, setLabel] = useState(role?.label ?? '')
  const [secondFactor, setSecondFactor] = useState(role?.secondFactor ?? false)
  const [chosen, setChosen] = useState<readonly Right[]>(
    offeredHeld(role ?? start ?? { rights: [] }),
  )
  const [source, setSource] = useState(start?.key ?? '')
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [removing, setRemoving] = useState(false)
  const held = withImplied(chosen)

  const toggle = (right: Right, on: boolean) => {
    setChosen((before) => (on ? [...before, right] : before.filter((each) => each !== right)))
  }

  const send = () => {
    const body = { label: label.trim(), rights: held, secondFactor }
    const found = ownRoleProblems(body)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setBusy(true)
    setTrouble(null)
    request<RoleEntry>(role === null ? '/roles' : `/roles/${encodeURIComponent(role.key)}`, {
      method: role === null ? 'POST' : 'PATCH',
      body: JSON.stringify(body),
    })
      .then(async (saved) => {
        await changed()
        void navigate({ to: rolePlaces.role(saved.key) })
      })
      .catch((error: unknown) => {
        setTrouble(error instanceof RequestRefused ? error.message : roleFormWords.offline)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const remove = () => {
    if (role === null) {
      return
    }

    setBusy(true)
    setTrouble(null)
    request(`/roles/${encodeURIComponent(role.key)}`, { method: 'DELETE' })
      .then(async () => {
        await changed()
        void navigate({ to: rolePlaces.list })
      })
      .catch((error: unknown) => {
        setTrouble(error instanceof RequestRefused ? error.message : roleFormWords.offline)
      })
      .finally(() => {
        setBusy(false)
        setRemoving(false)
      })
  }

  const inUse = role !== null && (role.holders > 0 || role.invited > 0)

  return (
    <SettingsPage
      active="rollen"
      title={role === null ? roleFormWords.newTitle : role.label}
      sub={
        role === null
          ? roleFormWords.newSub
          : roleFormWords.ownSub(offeredHeld(role).length, role.holders)
      }
      actions={
        keeps ? (
          <>
            {role === null ? (
              <Button
                onClick={() => {
                  void navigate({ to: rolePlaces.list })
                }}
              >
                {roleFormWords.cancel}
              </Button>
            ) : (
              <Button
                tone="danger"
                disabled={inUse || busy}
                onClick={() => {
                  setRemoving(true)
                }}
              >
                {rolesWords.remove}
              </Button>
            )}
            <Button tone="primary" icon={Check} disabled={busy} onClick={send}>
              {role === null ? roleFormWords.create : roleFormWords.save}
            </Button>
          </>
        ) : null
      }
    >
      {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
      <Panel title="Rolle">
        <div className="flex flex-col gap-3">
          <div className={role === null ? 'grid gap-3 sm:grid-cols-2' : ''}>
            <Field
              label={roleFormWords.label}
              required
              starred
              value={label}
              placeholder={roleFormWords.labelHint}
              disabled={!keeps}
              {...(problems['label'] === undefined ? {} : { problem: problems['label'] })}
              onChange={(event) => {
                setLabel(event.target.value)
              }}
            />
            {role === null ? (
              <SelectField
                label={roleFormWords.from}
                value={source}
                hint={roleFormWords.fromHint}
                options={[
                  { value: '', label: roleFormWords.fromNone },
                  ...roles.map((each) => ({ value: each.key, label: each.label })),
                ]}
                onChange={(value) => {
                  const next = roles.find((each) => each.key === value)

                  setSource(value)
                  setChosen(offeredHeld(next ?? { rights: [] }))
                }}
              />
            ) : null}
          </div>
          <label className="flex items-start gap-2.5 text-[14px] leading-[1.4]">
            <input
              type="checkbox"
              checked={secondFactor}
              disabled={!keeps}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-copper-solid disabled:cursor-not-allowed"
              onChange={(event) => {
                setSecondFactor(event.target.checked)
              }}
            />
            <span>
              {roleFormWords.secondFactor}
              <span className="block text-[13px] text-ink-muted">
                {roleFormWords.secondFactorHint}
              </span>
            </span>
          </label>
        </div>
      </Panel>
      <NoteBox>{roleFormWords.together}</NoteBox>
      {problems['rights'] === undefined ? null : (
        <NoteBox tone="conflict">{problems['rights']}</NoteBox>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {rightGroups.map((group) => (
          <Panel key={group.title} title={group.title}>
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">{group.title}</legend>
              {group.rights.map((right) => {
                const by = impliedBy(right, held)
                const isNew = role !== null && role.newRights.includes(right)

                return (
                  <label
                    key={right}
                    className="flex items-start gap-2.5 py-1 text-[14px] leading-[1.4]"
                  >
                    <input
                      type="checkbox"
                      checked={held.includes(right)}
                      disabled={!keeps || by !== null}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-copper-solid disabled:cursor-not-allowed"
                      onChange={(event) => {
                        toggle(right, event.target.checked)
                      }}
                    />
                    <span>
                      {rightLabel[right]}
                      {isNew ? (
                        <span className="ml-1.5 inline-block rounded-[3px] border border-waiting-edge bg-waiting-fill px-[5px] text-[11px] font-bold text-waiting">
                          {roleFormWords.fresh}
                        </span>
                      ) : null}
                      {by === null ? null : (
                        <span className="block text-[12px] text-ink-muted">
                          {roleFormWords.comesWith(by)}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </fieldset>
          </Panel>
        ))}
        <Panel title={roleFormWords.reserved}>
          <ul aria-label={roleFormWords.reserved} className="flex flex-col gap-1">
            {leadingRights.map((right) => (
              <li key={right} className="flex items-center gap-2 text-[14px] text-ink-muted">
                <Lock size={14} strokeWidth={2.2} aria-hidden="true" />
                {rightLabel[right]}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] leading-[1.4] text-ink-muted">
            {roleFormWords.reservedWhy}
          </p>
        </Panel>
      </div>
      {role !== null && inUse ? (
        <SettingsText muted>{roleFormWords.inUse(role.holders, role.invited)}</SettingsText>
      ) : null}
      <Confirm
        open={removing}
        title={rolesWords.removeQuestion(role?.label ?? '')}
        confirm={rolesWords.remove}
        busy={busy}
        onCancel={() => {
          setRemoving(false)
        }}
        onConfirm={remove}
      >
        {rolesWords.removeWhat}
      </Confirm>
    </SettingsPage>
  )
}
