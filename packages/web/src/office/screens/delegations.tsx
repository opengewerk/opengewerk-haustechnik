import {
  byNameIn,
  type DelegationEntry,
  delegationLimits,
  delegationProblems,
  type DelegationReading,
  delegationRoleLabel,
  type DelegationScope,
  delegationScopeLabel,
  delegationScopes,
  delegationScopeWords,
  type DelegationState,
  delegationStateLabel,
  delegationStates,
  revocationProblems,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Choice,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, moment, today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useWho } from '@opengewerk/platform-web/session'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, Pencil, Plus, Signature, Trash2, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'

import {
  type GivenSignature,
  SignatureMark,
  SignatureWays,
  typedWay,
} from '../../app/signature-ways.js'
import { fingerprintOf } from '../../app/signing.js'
import { useAreas } from '../../session/areas.js'
import { useCatalogue } from '../../sync/catalogue.js'
import {
  delegationKey,
  delegationListPlace,
  delegationListQuery,
  delegationPdf,
  delegationPlaces,
  delegationQuery,
} from '../delegation-addresses.js'
import { dutyPlaces, dutyRegisterPlace, dutySearch } from '../duty-addresses.js'
import { usePdf } from '../pdf-button.js'
import { assetKindChoices } from '../register-filter.js'
import { dutyColleaguesQuery } from './duty.js'

/**
 * The delegations of the operator's duties in the office (#336, 4.3 of the
 * concept), as the boards "Pflichtenübertragungen" draw them: the list with
 * the person, the areas, the scope, the period and how each stands; the page
 * of one with what it says, the two signatures and the duties in its scope
 * today; writing one, signing it for the operator and revoking it. Only the
 * Leitung delegates; the person a delegation goes to signs under "Konto".
 */

export const delegationWords = {
  sub: 'Schriftliche Übertragungen der Betreiberpflichten (§ 13 Abs. 2 ArbSchG): wer wofür verantwortlich ist, unterschrieben von der Leitung und der beauftragten Person. Betreiberweit, nur für die Leitung.',
  listNote:
    'Eine Übertragung gilt mit beiden Unterschriften und lässt sich danach nicht mehr ändern; ihr Ende ist eine Frist unter „Fristen“. Eine beendete oder widerrufene bleibt lesbar.',
  none: 'Noch hat der Betreiber keine Pflicht übertragen.',
  noneFound: 'Keine Übertragung passt zu dem, wonach die Liste eingegrenzt ist.',
  noConnection: 'Die Pflichtenübertragungen kommen vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Pflichtenübertragungen werden geladen.',
  failed:
    'Die Pflichtenübertragungen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  notThere: 'Diese Pflichtenübertragung gibt es nicht, oder sie ist nicht für Sie.',
  formIntro: 'Bis zur ersten Unterschrift lässt sich die Übertragung ändern und entfernen.',
  delegateHint:
    'Wer ein Konto bei diesem Betreiber hat. Sie unterschreibt unter „Konto“ und findet dort ihre Ausfertigung.',
  scopeHint:
    'Jede Pflicht in den Bereichen und im Umfang hat die beauftragte Person als Verantwortliche, solange die Übertragung gilt.',
  endHint: 'Das Ende ist eine Frist; vorher erinnert sie die Leitung.',
  signNote:
    'Mit Ihrer Unterschrift überträgt der Betreiber die Pflichten, wie sie hier stehen. Danach lässt sich die Übertragung nicht mehr ändern, nur noch widerrufen.',
  signaturesNote:
    'Gültig ist die Übertragung mit beiden Unterschriften, jede für genau den Text, der hier steht. Danach ändert sie niemand mehr, auch nicht in der Datenbank.',
  operatorWaits: 'Noch nicht unterschrieben.',
  delegateWaits: (name: string) =>
    `Noch nicht unterschrieben. ${name} unterschreibt unter „Konto“; dort liegt danach die Ausfertigung.`,
  dutiesNote: (name: string) =>
    `Solange die Übertragung gilt, ist ${name} für jede dieser Pflichten verantwortlich. Deckt eine zweite Übertragung eine Pflicht, wählt das Büro an der Pflicht.`,
  dutiesNone: 'Im Umfang liegt heute keine Pflicht.',
  revokeHint:
    'Heute oder ein späterer Tag vor dem bisherigen Ende. An diesem Tag endet die Übertragung.',
  revokeNote:
    'Die Übertragung bleibt mit beiden Unterschriften lesbar. Ab dem Ende ist jede ihrer Pflichten ohne Verantwortlichen, bis eine andere Übertragung sie abdeckt.',
  removeQuestion: 'Diesen Entwurf entfernen? Unterschrieben hat ihn noch niemand.',
  nobody: 'niemand',
  without: 'ohne Übertragung',
  other: 'aus einer anderen Übertragung',
} as const

const stateLooks: Readonly<Record<DelegationState, StatusTone>> = {
  draft: 'neutral',
  waiting: 'waiting',
  upcoming: 'waiting',
  in_force: 'done',
  ended: 'neutral',
  revoked: 'neutral',
}

export function DelegationStateStatus({ state }: { readonly state: DelegationState }) {
  return <Status tone={stateLooks[state]}>{delegationStateLabel[state]}</Status>
}

/** "Alle Pflichten", "Paket Elektro", "Kostengruppen 440, 470", with the titles of the catalogue. */
export function useScopeWords(): (
  entry: Pick<DelegationEntry, 'scope' | 'packages' | 'costGroups'>,
) => string {
  const catalogue = useCatalogue()
  const titleOf = (name: string) =>
    catalogue?.packages.find((pack) => pack.name === name)?.title ?? name

  return (entry) => delegationScopeWords(entry, titleOf)
}

/** "01.11.2026 bis 31.10.2028", with the day a revocation brought it to. */
export function periodWords(
  entry: Pick<DelegationEntry, 'startsOn' | 'endsOn' | 'lastDay'>,
): string {
  return entry.lastDay < entry.endsOn
    ? `${date(entry.startsOn)} bis ${date(entry.lastDay)}, widerrufen`
    : `${date(entry.startsOn)} bis ${date(entry.endsOn)}`
}

/** The areas of a delegation in words. */
export function areaWords(entry: Pick<DelegationEntry, 'areas'>): string {
  return entry.areas.map((area) => area.name).join(', ')
}

/** The areas as a title says them: "Bereich Nord", "Bereiche Nord und Süd". */
export function areaTitle(entry: Pick<DelegationEntry, 'areas'>): string {
  const names = entry.areas.map((area) => area.name)
  const last = names.at(-1) ?? ''

  return names.length === 1
    ? `Bereich ${last}`
    : `Bereiche ${[names.slice(0, -1).join(', '), last].join(' und ')}`
}

/** A signature under a delegation for the page as it is shown; the refusal in words, or null. */
export async function signDelegation(
  reading: DelegationReading,
  given: GivenSignature,
): Promise<string | null> {
  try {
    await request(`/delegations/${encodeURIComponent(reading.id)}/sign`, {
      method: 'POST',
      body: JSON.stringify({ pageFingerprint: await fingerprintOf(reading.page), ...given }),
    })

    return null
  } catch (error) {
    return error instanceof RequestRefused ? error.message : delegationWords.noConnection
  }
}

function Loading({ failed, paused }: { readonly failed: boolean; readonly paused: boolean }) {
  return (
    <Panel>
      <Empty>
        {failed
          ? delegationWords.failed
          : paused
            ? delegationWords.noConnection
            : delegationWords.loading}
      </Empty>
    </Panel>
  )
}

const refusedOnce = (count: number, error: Error) => !(error instanceof RequestRefused) && count < 2

export function DelegationListScreen() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [making, setMaking] = useState(false)
  const wanted = useDeferredValue(search.trim().toLocaleLowerCase('de'))
  const listed = useQuery({ ...delegationListQuery, retry: refusedOnce })
  const scopeWords = useScopeWords()
  const all = listed.data?.delegations ?? []
  const rows = all.filter(
    (entry) =>
      (state === '' || entry.state === state) &&
      (wanted === '' || entry.delegateName.toLocaleLowerCase('de').includes(wanted)),
  )
  const counts = listed.data?.duties

  return (
    <Screen>
      <PageHead
        title="Pflichtenübertragungen"
        {...(listed.data === undefined
          ? {}
          : { count: all.length === 1 ? '1 Übertragung' : `${String(all.length)} Übertragungen` })}
        sub={delegationWords.sub}
      />
      {counts === undefined ||
      (counts.withoutResponsible === 0 && counts.withoutDelegation === 0) ? null : (
        <NoteBox
          tone="waiting"
          action={
            <Link to={dutyRegisterPlace.to} search={dutySearch({ responsible: 'none' })}>
              Im Pflichtenverzeichnis anzeigen
            </Link>
          }
        >
          {`${counts.withoutResponsible.toLocaleString('de-DE')} ${counts.withoutResponsible === 1 ? 'Pflicht in Ihren Bereichen hat' : 'Pflichten in Ihren Bereichen haben'} keine verantwortliche Person, ${counts.withoutDelegation.toLocaleString('de-DE')} eine ohne Übertragung.`}
        </NoteBox>
      )}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div className="w-[240px] max-lg:w-full">
          <Field
            label="Suche"
            type="search"
            value={search}
            placeholder="Person"
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <div className="w-[200px] max-lg:w-full">
          <SelectField
            label="Stand"
            value={state}
            options={[
              { value: '', label: 'Alle' },
              ...delegationStates.map((each) => ({
                value: each,
                label: delegationStateLabel[each],
              })),
            ]}
            onChange={setState}
          />
        </div>
        <span className="grow max-lg:hidden" />
        <Button
          tone="primary"
          icon={Plus}
          onClick={() => {
            setMaking(true)
          }}
        >
          Übertragung anlegen
        </Button>
      </div>
      {listed.data === undefined ? (
        <Loading failed={listed.isError} paused={listed.fetchStatus === 'paused'} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>{all.length === 0 ? delegationWords.none : delegationWords.noneFound}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Pflichtenübertragungen mit Person, Bereichen, Umfang, Zeitraum und Stand"
          note={delegationWords.listNote}
          cards={rows.map((entry) => ({
            key: entry.id,
            title: <Link to={delegationPlaces.delegation(entry.id)}>{entry.delegateName}</Link>,
            sub: [areaWords(entry), scopeWords(entry), periodWords(entry)].join(' · '),
            right: <DelegationStateStatus state={entry.state} />,
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[180px]">Beauftragte Person</Column>
              <Column className="w-[140px] min-w-[110px]">Bereiche</Column>
              <Column className="w-[230px] min-w-[160px]">Umfang</Column>
              <Column className="w-[230px] min-w-[180px]">Zeitraum</Column>
              <Column className="w-[200px] min-w-[170px]">Stand</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <Cell>
                  <Link to={delegationPlaces.delegation(entry.id)} className="font-medium">
                    {entry.delegateName}
                  </Link>
                </Cell>
                <Cell>{areaWords(entry)}</Cell>
                <Cell>{scopeWords(entry)}</Cell>
                <Cell>{periodWords(entry)}</Cell>
                <Cell>
                  <DelegationStateStatus state={entry.state} />
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {making ? (
        <DelegationDialog
          onClose={() => {
            setMaking(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** The checkboxes of a choice of several, labelled like the choice of one beside them. */
function Several({
  label,
  options,
  chosen,
  onChange,
  problem,
}: {
  readonly label: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly chosen: readonly string[]
  readonly onChange: (chosen: readonly string[]) => void
  readonly problem?: string | undefined
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
        {label}
      </legend>
      <div className="flex flex-wrap gap-x-[18px] gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={chosen.includes(option.value)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...chosen, option.value]
                    : chosen.filter((each) => each !== option.value),
                )
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
      {problem === undefined ? null : (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {problem}
        </p>
      )}
    </fieldset>
  )
}

/** "Übertragung anlegen", and the same form to change a delegation nobody signed yet. */
export function DelegationDialog({
  delegation,
  onClose,
}: {
  readonly delegation?: DelegationReading
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const navigate = useNavigate()
  const colleagues = useQuery(dutyColleaguesQuery)
  const areas = useAreas()
  const catalogue = useCatalogue()
  const [delegateUserId, setDelegate] = useState(delegation?.delegateUserId ?? '')
  const [areaIds, setAreaIds] = useState<readonly string[]>(
    delegation?.areas.map((area) => area.id) ?? [],
  )
  const [scope, setScope] = useState<DelegationScope>(delegation?.scope ?? 'all')
  const [packages, setPackages] = useState<readonly string[]>(delegation?.packages ?? [])
  const [costGroups, setCostGroups] = useState<readonly string[]>(delegation?.costGroups ?? [])
  const [startsOn, setStartsOn] = useState<string>(delegation?.startsOn ?? '')
  const [endsOn, setEndsOn] = useState<string>(delegation?.endsOn ?? '')
  const [tasks, setTasks] = useState(delegation?.tasks ?? '')
  const [powers, setPowers] = useState(delegation?.powers ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const problemOf = (field: string) =>
    problems[field] === undefined ? {} : { problem: problems[field] }
  const people = (colleagues.data ?? [])
    .filter((each) => each.active || each.userId === delegateUserId)
    .sort((left, right) => byNameIn(left.name, right.name))
  const costGroupChoices = [
    ...new Set(assetKindChoices(catalogue).map((kind) => kind.costGroup)),
  ].sort()

  async function send() {
    const values = {
      delegateUserId,
      areaIds,
      scope,
      packages: scope === 'packages' ? packages : [],
      costGroups: scope === 'cost_groups' ? costGroups : [],
      tasks: tasks.trim(),
      powers: powers.trim(),
      startsOn,
      endsOn,
    }
    const found = delegationProblems(values)

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const answer = await request<DelegationReading>(
        delegation === undefined
          ? '/delegations'
          : `/delegations/${encodeURIComponent(delegation.id)}`,
        { method: delegation === undefined ? 'POST' : 'PATCH', body: JSON.stringify(values) },
      )

      await queries.invalidateQueries({ queryKey: delegationKey })
      onClose()

      if (delegation === undefined) {
        void navigate({ to: delegationPlaces.delegation(answer.id) })
      }
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : delegationWords.noConnection)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title={delegation === undefined ? 'Übertragung anlegen' : 'Übertragung bearbeiten'}
      width={640}
      onClose={onClose}
      sub={delegationWords.formIntro}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <SelectField
          label="Beauftragte Person"
          required
          starred
          value={delegateUserId}
          hint={delegationWords.delegateHint}
          options={[
            { value: '', label: 'Bitte wählen' },
            ...people.map((person) => ({ value: person.userId, label: person.name })),
          ]}
          onChange={setDelegate}
          {...problemOf('delegateUserId')}
        />
        <Several
          label="Bereiche"
          options={areas.map((area) => ({ value: area.id, label: area.name }))}
          chosen={areaIds}
          onChange={setAreaIds}
          problem={problems['areaIds']}
        />
        <Choice<DelegationScope>
          label="Umfang"
          value={scope}
          onChange={setScope}
          options={delegationScopes.map((each) => ({
            value: each,
            label: delegationScopeLabel[each],
          }))}
        />
        {scope === 'packages' ? (
          <Several
            label="Pakete"
            options={(catalogue?.packages ?? []).map((pack) => ({
              value: pack.name,
              label: pack.title,
            }))}
            chosen={packages}
            onChange={setPackages}
            problem={problems['packages']}
          />
        ) : scope === 'cost_groups' ? (
          <Several
            label="Kostengruppen"
            options={costGroupChoices.map((group) => ({ value: group, label: `KG ${group}` }))}
            chosen={costGroups}
            onChange={setCostGroups}
            problem={problems['costGroups']}
          />
        ) : null}
        <p className="text-[12px] leading-[1.4] text-ink-faint">{delegationWords.scopeHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Beginn"
            type="date"
            required
            starred
            value={startsOn}
            {...problemOf('startsOn')}
            onChange={(event) => {
              setStartsOn(event.target.value)
            }}
          />
          <Field
            label="Ende"
            type="date"
            required
            starred
            value={endsOn}
            hint={delegationWords.endHint}
            {...problemOf('endsOn')}
            onChange={(event) => {
              setEndsOn(event.target.value)
            }}
          />
        </div>
        <TextArea
          label="Aufgaben"
          rows={3}
          required
          starred
          maxLength={delegationLimits.tasks}
          value={tasks}
          problem={problems['tasks']}
          onChange={(event) => {
            setTasks(event.target.value)
          }}
        />
        <TextArea
          label="Befugnisse"
          rows={3}
          required
          starred
          maxLength={delegationLimits.powers}
          value={powers}
          problem={problems['powers']}
          onChange={(event) => {
            setPowers(event.target.value)
          }}
        />
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Einen Moment' : delegation === undefined ? 'Anlegen' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** A signature under a delegation as the page shows it: the drawing or the typed name, the person and the moment. */
function SignedBy({ signature }: { readonly signature: DelegationReading['signatures'][number] }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[150px] shrink-0 rounded-control border border-line bg-surface">
        <SignatureMark
          name={signature.name}
          path={signature.path}
          typedName={signature.typedName}
        />
      </div>
      <div className="leading-[1.4]">
        <div className="text-[14px] font-semibold">{signature.name}</div>
        <div className="text-[13px] text-ink-muted">{`${delegationRoleLabel[signature.role]}, ${moment(signature.signedAt)}${typedWay(signature.typedName)}`}</div>
      </div>
    </div>
  )
}

/** Signing a delegation: the way to sign, the name, and the button; the refusal of the server in words. */
export function SignHere({
  reading,
  note,
  onSigned,
  onCancel,
}: {
  readonly reading: DelegationReading
  readonly note: string
  readonly onSigned: () => void
  readonly onCancel?: () => void
}) {
  const { name } = useWho()
  const [given, setGiven] = useState<GivenSignature | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function sign() {
    if (given === null) {
      setTrouble('Es fehlt die Unterschrift: der Schriftzug im Feld oder der getippte Name.')

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const refused = await signDelegation(reading, given)

      if (refused === null) {
        onSigned()
      } else {
        setTrouble(refused)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] leading-[1.45] text-ink-muted">{note}</p>
      <SignatureWays label="Unterschrift" name={name} onChange={setGiven} />
      <div className="text-[13px] font-semibold">{name}</div>
      {trouble === null ? null : (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel === undefined ? null : (
          <Button disabled={working} onClick={onCancel}>
            Abbrechen
          </Button>
        )}
        <Button
          tone="primary"
          icon={Signature}
          disabled={working}
          onClick={() => {
            void sign()
          }}
        >
          Unterschreiben
        </Button>
      </div>
    </div>
  )
}

/** What a delegation says: the person, the areas, the scope, the period, the tasks and the powers. */
export function DelegationTerms({ reading }: { readonly reading: DelegationReading }) {
  const scopeWords = useScopeWords()

  return (
    <div className="flex flex-col gap-3">
      <FactList
        keyWidth={140}
        facts={[
          { label: 'Beauftragte Person', value: reading.delegateName },
          { label: 'Bereiche', value: areaWords(reading) },
          { label: 'Umfang', value: scopeWords(reading) },
          { label: 'Beginn', value: date(reading.startsOn) },
          {
            label: 'Ende',
            value:
              reading.revocation === null
                ? date(reading.endsOn)
                : `${date(reading.lastDay)}, widerrufen`,
          },
        ]}
      />
      <div>
        <div className="font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
          Aufgaben
        </div>
        <p className="text-[14px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-line">
          {reading.tasks}
        </p>
      </div>
      <div>
        <div className="font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
          Befugnisse
        </div>
        <p className="text-[14px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-line">
          {reading.powers}
        </p>
      </div>
    </div>
  )
}

/** Who answers for a duty in the scope today, and where that comes from. */
function fromWords(line: DelegationReading['duties']['shown'][number]): string {
  switch (line.from) {
    case 'this':
      return 'aus dieser Übertragung'
    case 'other':
      return delegationWords.other
    case 'none':
      return delegationWords.without
    case 'nobody':
      return ''
  }
}

export function DelegationScreen() {
  const { delegationId } = useParams({ strict: false }) as { delegationId?: string }
  const page = useQuery({
    ...delegationQuery(delegationId ?? ''),
    enabled: delegationId !== undefined,
    retry: refusedOnce,
  })
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [signing, setSigning] = useState(false)
  const reading = page.data
  const pdf = usePdf(
    delegationPdf(delegationId ?? ''),
    `Pflichtenübertragung ${reading?.delegateName ?? ''}`,
  )

  if (reading === undefined || delegationId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Pflichtenübertragung'}
          crumbs={[delegationListPlace]}
          phoneBack={delegationListPlace}
        />
        {gone ? (
          <Empty>{delegationWords.notThere}</Empty>
        ) : (
          <Loading failed={page.isError} paused={page.fetchStatus === 'paused'} />
        )}
      </Screen>
    )
  }

  const operator = reading.signatures.find((signature) => signature.role === 'operator')
  const delegate = reading.signatures.find((signature) => signature.role === 'delegate')
  const draft = reading.signatures.length === 0
  const revocable = !draft && reading.revocation === null && reading.lastDay >= today()
  const reread = () => queries.invalidateQueries({ queryKey: delegationKey })

  return (
    <Screen>
      <PageHead
        title={`Pflichtenübertragung an ${reading.delegateName}`}
        sub={areaTitle(reading)}
        crumbs={[delegationListPlace]}
        phoneBack={delegationListPlace}
        badges={<DelegationStateStatus state={reading.state} />}
        actions={
          <>
            <ChangesButton table="duty_delegations" id={reading.id} />
            {pdf.button}
            {draft ? (
              <>
                <Button
                  tone="danger"
                  icon={Trash2}
                  onClick={() => {
                    setRemoving(true)
                  }}
                >
                  Entfernen
                </Button>
                <Button
                  icon={Pencil}
                  onClick={() => {
                    setEditing(true)
                  }}
                >
                  Bearbeiten
                </Button>
              </>
            ) : null}
            {revocable ? (
              <Button
                icon={X}
                onClick={() => {
                  setRevoking(true)
                }}
              >
                Widerrufen
              </Button>
            ) : null}
          </>
        }
      />
      {pdf.trouble}
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {reading.revocation === null ? null : (
            <NoteBox>
              {`Widerrufen am ${moment(reading.revocation.at)} von ${reading.revocation.name}, mit Wirkung zum ${date(reading.revocation.effectiveOn)}: „${reading.revocation.reason}“. Ihre Pflichten sind danach ohne Verantwortlichen, bis eine andere Übertragung sie abdeckt.`}
            </NoteBox>
          )}
          <Panel title="Übertragung">
            <DelegationTerms reading={reading} />
          </Panel>
          <Panel
            title={signing ? 'Unterschreiben' : 'Unterschriften'}
            {...(reading.signs === 'operator' && !signing
              ? {
                  action: (
                    <Button
                      size="small"
                      icon={Signature}
                      onClick={() => {
                        setSigning(true)
                      }}
                    >
                      Unterschreiben
                    </Button>
                  ),
                }
              : {})}
          >
            {signing ? (
              <SignHere
                reading={reading}
                note={delegationWords.signNote}
                onSigned={() => {
                  setSigning(false)
                  void reread()
                }}
                onCancel={() => {
                  setSigning(false)
                }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
                    {delegationRoleLabel.operator}
                  </div>
                  {operator === undefined ? (
                    <p className="text-[13px] text-ink-muted">{delegationWords.operatorWaits}</p>
                  ) : (
                    <SignedBy signature={operator} />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
                    {delegationRoleLabel.delegate}
                  </div>
                  {delegate === undefined ? (
                    <p className="text-[13px] text-ink-muted">
                      {delegationWords.delegateWaits(reading.delegateName)}
                    </p>
                  ) : (
                    <SignedBy signature={delegate} />
                  )}
                </div>
                <p className="text-[12px] leading-[1.4] text-ink-faint">
                  {delegationWords.signaturesNote}
                </p>
              </div>
            )}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {reading.duties.total === 0 ? (
            <Panel title="Pflichten im Umfang">
              <p className="text-[13px] text-ink-muted">{delegationWords.dutiesNone}</p>
            </Panel>
          ) : (
            <TablePanel
              title="Pflichten im Umfang"
              caption="Pflichten im Umfang der Übertragung mit Ort und wer heute verantwortlich ist"
              grow={false}
              note={delegationWords.dutiesNote(reading.delegateName)}
              cards={reading.duties.shown.map((line) => ({
                key: line.dutyId,
                title: <Link to={dutyPlaces.duty(line.dutyId)}>{line.title}</Link>,
                sub: [line.place, line.responsible ?? delegationWords.nobody, fromWords(line)]
                  .filter((part) => part !== '')
                  .join(' · '),
              }))}
              {...(reading.duties.total > reading.duties.shown.length
                ? {
                    footer: (
                      <span>{`${String(reading.duties.shown.length)} von ${String(reading.duties.total)}`}</span>
                    ),
                  }
                : {})}
            >
              <thead>
                <tr>
                  <Column className="min-w-[150px]">Pflicht</Column>
                  <Column className="w-[170px] min-w-[150px]">Verantwortlich heute</Column>
                </tr>
              </thead>
              <tbody>
                {reading.duties.shown.map((line) => (
                  <tr key={line.dutyId}>
                    <Cell>
                      <div className="leading-[1.32]">
                        <Link to={dutyPlaces.duty(line.dutyId)} className="font-medium">
                          {line.title}
                        </Link>
                        <div className="text-[12px] text-ink-faint">{line.place}</div>
                      </div>
                    </Cell>
                    <Cell>
                      {line.responsible === null ? (
                        <span className="font-semibold text-waiting">{delegationWords.nobody}</span>
                      ) : (
                        <div className="leading-[1.32]">
                          <div>{line.responsible}</div>
                          <div className="text-[12px] text-ink-faint">{fromWords(line)}</div>
                        </div>
                      )}
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )}
          {draft ? null : (
            <Panel title="Frist">
              <FactList
                keyWidth={96}
                facts={[
                  { label: 'Frist', value: 'Ende einer Pflichtenübertragung' },
                  { label: 'Fällig', value: date(reading.lastDay) },
                  { label: 'Erinnert', value: 'die Leitung, wenn der Vorlauf beginnt' },
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
      {editing ? (
        <DelegationDialog
          delegation={reading}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : null}
      {revoking ? (
        <RevokeDialog
          reading={reading}
          onClose={() => {
            setRevoking(false)
          }}
        />
      ) : null}
      {removing ? (
        <Confirm
          open
          title="Entwurf entfernen"
          tone="danger"
          confirm="Entfernen"
          onCancel={() => {
            setRemoving(false)
          }}
          onConfirm={async () => {
            try {
              await request(`/delegations/${encodeURIComponent(reading.id)}`, { method: 'DELETE' })
              await queries.invalidateQueries({ queryKey: delegationKey })
              void navigate({ to: delegationListPlace.to })
            } catch {
              setRemoving(false)
            }
          }}
        >
          {delegationWords.removeQuestion}
        </Confirm>
      ) : null}
    </Screen>
  )
}

/** "Übertragung widerrufen": the day it ends on now and the reason. */
function RevokeDialog({
  reading,
  onClose,
}: {
  readonly reading: DelegationReading
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [effectiveOn, setEffectiveOn] = useState<string>(today())
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function send() {
    const values = { effectiveOn, reason: reason.trim() }
    const found = revocationProblems(values, reading, today())

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      await request(`/delegations/${encodeURIComponent(reading.id)}/revoke`, {
        method: 'POST',
        body: JSON.stringify(values),
      })
      await queries.invalidateQueries({ queryKey: delegationKey })
      onClose()
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : delegationWords.noConnection)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Übertragung widerrufen"
      width={520}
      onClose={onClose}
      sub={`Pflichtenübertragung an ${reading.delegateName}`}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <Field
          label="Endet am"
          type="date"
          required
          starred
          value={effectiveOn}
          hint={delegationWords.revokeHint}
          {...(problems['effectiveOn'] === undefined ? {} : { problem: problems['effectiveOn'] })}
          onChange={(event) => {
            setEffectiveOn(event.target.value)
          }}
        />
        <TextArea
          label="Grund"
          rows={2}
          required
          starred
          maxLength={delegationLimits.reason}
          value={reason}
          problem={problems['reason']}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox>{delegationWords.revokeNote}</NoteBox>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="danger" icon={X} disabled={working}>
            {working ? 'Einen Moment' : 'Widerrufen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
