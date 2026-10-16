import {
  type ContractEntry,
  type ContractStanding,
  contractStandingLabel,
  contractStandings,
  noticeWords,
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
import { date } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Screen,
  useTableExport,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { type ReactNode, useDeferredValue, useState } from 'react'

import { askAt } from '../../sync/made-at.js'
import {
  contractKey,
  contractListQuery,
  contractPlaces,
  contractQuery,
} from '../contract-addresses.js'
import { ContractDialog, CoverDialog } from '../contract-dialogs.js'
import { contractorPlaces } from '../contractor-addresses.js'
import { useContractorNames } from '../contractor-field.js'
import { DocumentsCard } from '../documents.js'
import { dutyPlaces, dutyRegisterPlace, dutyRegisterWords } from '../duty-addresses.js'
import { officePlaces } from '../place-addresses.js'

/**
 * The contracts of the operator in the office (#329, 4.11 of the concept),
 * as the boards "Verträge" and "Ein Vertrag" draw them: the list with what
 * each covers, its term and the last day to give notice, and the page of a
 * contract with its term, what it says about response and price, its
 * documents, what it covers and the duties it fulfils. Tenant-wide and
 * without an area; what a contract covers is shown from the areas of the
 * person. The Leitung, the Technische Leitung and the Objektleitung read the
 * contracts ("Verträge ansehen"), the Leitung and the Technische Leitung keep
 * them ("Verträge führen").
 */

export const contractWords = {
  sub: 'Verträge mit Fremdfirmen: was sie erfassen, welche Pflichten sie erfüllen, Laufzeit und Kündigung. Betreiberweit, ohne Bereich.',
  loading: 'Wird geladen.',
  failed: 'Die Verträge ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  noConnection: 'Ohne Verbindung. Die Verträge kommen vom Server.',
  none: 'Noch kein Vertrag. Legen Sie einen an.',
  noneFound: 'Kein Vertrag passt zur Suche.',
  searchPlaceholder: 'Vertrag oder Firma',
  everyFirm: 'Alle Fremdfirmen',
  everyStanding: 'Alle',
  listNote:
    'Erfasst zählt die Gebäude und Anlagen in Ihren Bereichen. Ein Vertrag, der nicht mehr gilt, bleibt lesbar; entfernt wird nur einer, der irrtümlich angelegt ist.',
  noNotice: 'keine',
  unlimited: 'unbefristet',
  removed: 'Entfernt. Der Vertrag steht in keiner Auswahl mehr.',
  removal:
    'Entfernt wird ein Vertrag, der irrtümlich angelegt ist, mit seinen Dokumenten. Einer, der endet, bleibt stehen.',
  coveredNote: 'Gebäude und Anlagen in Ihren Bereichen. Ein Gebäude erfasst seine Anlagen mit.',
  nothingCovered: 'Der Vertrag erfasst noch kein Gebäude und keine Anlage in Ihren Bereichen.',
  dutiesNote:
    'Eine Pflicht nennt den Vertrag unter „Zuständig“. Endet er, sagt sie „Vertrag abgelaufen“.',
  noDuty: 'Keine offene Pflicht nennt diesen Vertrag.',
} as const

/** The tone a contract shows how it stands in. */
const standingTone: Readonly<
  Record<ContractStanding, 'done' | 'waiting' | 'neutral' | 'conflict'>
> = {
  upcoming: 'neutral',
  running: 'done',
  renews: 'waiting',
  cancelled: 'neutral',
  ended: 'conflict',
}

export function ContractStandingStatus({ standing }: { readonly standing: ContractStanding }) {
  return (
    <Status
      tone={standingTone[standing]}
      {...(standing === 'ended' ? { icon: TriangleAlert } : {})}
    >
      {contractStandingLabel[standing]}
    </Status>
  )
}

/** "bis 31.12.2026, verlängert sich um 12 Monate", "gekündigt zum 31.12.2026", "unbefristet". */
export function termWords(contract: ContractEntry): string {
  if (contract.cancelledTo !== null) {
    return `gekündigt zum ${date(contract.cancelledTo)}`
  }

  if (contract.runsUntil === null) {
    return contractWords.unlimited
  }

  return contract.renewalMonths === null
    ? `bis ${date(contract.runsUntil)}`
    : `bis ${date(contract.runsUntil)}, verlängert sich um ${String(contract.renewalMonths)} ${contract.renewalMonths === 1 ? 'Monat' : 'Monate'}`
}

/** "2 Gebäude, 3 Anlagen", or "nichts" where it covers nothing the person sees. */
function coveredWords(contract: ContractEntry): string {
  const parts = [
    contract.buildings === 0
      ? null
      : `${String(contract.buildings)} ${contract.buildings === 1 ? 'Gebäude' : 'Gebäude'}`,
    contract.assets === 0
      ? null
      : `${String(contract.assets)} ${contract.assets === 1 ? 'Anlage' : 'Anlagen'}`,
  ].filter((part) => part !== null)

  return parts.length === 0 ? 'nichts' : parts.join(', ')
}

function Loading({ failed, paused }: { readonly failed: boolean; readonly paused: boolean }) {
  return (
    <Panel>
      <Empty>
        {failed
          ? contractWords.failed
          : paused
            ? contractWords.noConnection
            : contractWords.loading}
      </Empty>
    </Panel>
  )
}

const refusedOnce = (count: number, error: Error) => !(error instanceof RequestRefused) && count < 2

/**
 * "Verträge", the board of that name: every live contract with its firm,
 * what it covers, its term, the last day to give notice and how it stands,
 * searched by title and firm. Whoever keeps the contracts makes one.
 */
export function ContractListScreen() {
  const keeps = useRight('contract.write')
  const [search, setSearch] = useState('')
  const [firm, setFirm] = useState('')
  const [standing, setStanding] = useState('')
  const wanted = useDeferredValue(search.trim().toLocaleLowerCase('de'))
  const [making, setMaking] = useState(false)
  const contracts = useQuery({ ...contractListQuery, retry: refusedOnce })
  const table = useTableExport('/contracts/table')
  const all = contracts.data ?? []
  const firms = [...new Map(all.map((each) => [each.contractorId, each.contractorName]))]
  const rows = all.filter(
    (contract) =>
      (firm === '' || contract.contractorId === firm) &&
      (standing === '' || contract.standing === standing) &&
      (wanted === '' ||
        [contract.title, contract.contractorName].some((text) =>
          text.toLocaleLowerCase('de').includes(wanted),
        )),
  )

  return (
    <Screen>
      <PageHead
        title="Verträge"
        {...(contracts.data === undefined
          ? {}
          : { count: all.length === 1 ? '1 Vertrag' : `${String(all.length)} Verträge` })}
        sub={contractWords.sub}
      />
      {table.trouble}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div className="w-[280px] max-lg:w-full">
          <Field
            label="Suche"
            type="search"
            value={search}
            placeholder={contractWords.searchPlaceholder}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <div className="w-[240px] max-lg:w-full">
          <SelectField
            label="Fremdfirma"
            value={firm}
            options={[
              { value: '', label: contractWords.everyFirm },
              ...firms.map(([id, name]) => ({ value: id, label: name })),
            ]}
            onChange={setFirm}
          />
        </div>
        <div className="w-[170px] max-lg:w-full">
          <SelectField
            label="Stand"
            value={standing}
            options={[
              { value: '', label: contractWords.everyStanding },
              ...contractStandings.map((each) => ({
                value: each,
                label: contractStandingLabel[each],
              })),
            ]}
            onChange={setStanding}
          />
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5">
          {table.button}
          {keeps ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                setMaking(true)
              }}
            >
              Vertrag anlegen
            </Button>
          ) : null}
        </div>
      </div>
      {contracts.data === undefined ? (
        <Loading failed={contracts.isError} paused={contracts.fetchStatus === 'paused'} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>{all.length === 0 ? contractWords.none : contractWords.noneFound}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Verträge mit Firma, Erfasstem, Laufzeit, Kündigung und Stand"
          note={contractWords.listNote}
          cards={rows.map((contract) => ({
            key: contract.id,
            title: <Link to={contractPlaces.contract(contract.id)}>{contract.title}</Link>,
            sub: [contract.contractorName, termWords(contract)].join(' · '),
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[220px]">Vertrag</Column>
              <Column className="w-[170px] min-w-[130px]">Erfasst</Column>
              <Column className="w-[260px] min-w-[180px]">Laufzeit</Column>
              <Column className="w-[120px] min-w-[110px]" align="right">
                Kündigung bis
              </Column>
              <Column className="w-[150px] min-w-[130px]">Stand</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((contract) => (
              <tr key={contract.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <Link to={contractPlaces.contract(contract.id)} className="font-medium">
                      {contract.title}
                    </Link>
                    <div className="text-[12px] text-ink-faint">{contract.contractorName}</div>
                  </div>
                </Cell>
                <Cell>{coveredWords(contract)}</Cell>
                <Cell>{termWords(contract)}</Cell>
                <Cell align="right">
                  {contract.noticeBy === null ? (
                    <span className="text-ink-faint">{contractWords.noNotice}</span>
                  ) : (
                    <span className="font-semibold">{date(contract.noticeBy)}</span>
                  )}
                </Cell>
                <Cell>
                  <ContractStandingStatus standing={contract.standing} />
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {making ? (
        <ContractDialog
          onClose={() => {
            setMaking(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

function Card({
  title,
  action,
  children,
}: {
  readonly title: string
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Panel>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <h2 className="font-condensed text-label font-semibold tracking-[1.1px] uppercase text-ink-faint">
            {title}
          </h2>
          <span className="grow" />
          {action}
        </div>
        {children}
      </div>
    </Panel>
  )
}

/**
 * The page of a contract, `vertrag()` of the boards: its term with the last
 * day to give notice, what it says about response time and price, its
 * documents, what it covers in the areas of the person and the duties it
 * fulfils. A removed contract keeps its page, so that what named it leads
 * somewhere.
 */
export function ContractScreen() {
  const { contractId } = useParams({ strict: false }) as { contractId: string }
  const keeps = useRight('contract.write')
  const readsDuties = useRight('duty.read')
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const firmNames = useContractorNames()
  const [editing, setEditing] = useState(false)
  const [covering, setCovering] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const page = useQuery({ ...contractQuery(contractId), retry: refusedOnce })

  if (page.data === undefined) {
    return (
      <Screen>
        <PageHead title="Vertrag" crumbs={[{ to: contractPlaces.list, label: 'Verträge' }]} />
        <Loading failed={page.isError} paused={page.fetchStatus === 'paused'} />
      </Screen>
    )
  }

  const { contract, items, duties } = page.data
  const removed = contract.deletedAt !== null
  const changes = keeps && !removed

  async function remove() {
    setTrouble(null)

    const result = await askAt(
      client,
      'DELETE',
      `/contracts/${encodeURIComponent(contract.id)}`,
      contract.id,
    )

    setRemoving(false)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await queries.invalidateQueries({ queryKey: contractKey })
    void navigate({ to: contractPlaces.list })
  }

  async function uncover(itemId: string) {
    setTrouble(null)

    const result = await askAt(
      client,
      'DELETE',
      `/contracts/${encodeURIComponent(contract.id)}/items/${encodeURIComponent(itemId)}`,
      contract.id,
    )

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await queries.invalidateQueries({ queryKey: contractKey })
  }

  return (
    <Screen>
      <PageHead
        title={contract.title}
        crumbs={[{ to: contractPlaces.list, label: 'Verträge' }]}
        sub={`Vertrag mit ${contract.contractorName}`}
        badges={<ContractStandingStatus standing={contract.standing} />}
        actions={
          <>
            <ChangesButton table="contracts" id={contract.id} />
            {changes ? (
              <>
                <Button
                  icon={Trash2}
                  tone="danger"
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
          </>
        }
      />
      {removed ? <NoteBox tone="neutral">{contractWords.removed}</NoteBox> : null}
      {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
      <div className="grid items-start gap-3.5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <Card title="Laufzeit und Kündigung">
            <FactList
              keyWidth={120}
              facts={[
                { label: 'Beginn', value: date(contract.startsOn) },
                {
                  label: 'Ende der Laufzeit',
                  value: contract.endsOn === null ? contractWords.unlimited : date(contract.endsOn),
                },
                {
                  label: 'Verlängerung',
                  value:
                    contract.renewalMonths === null
                      ? 'keine'
                      : `um ${String(contract.renewalMonths)} ${contract.renewalMonths === 1 ? 'Monat' : 'Monate'}, wenn nicht gekündigt`,
                },
                ...(contract.cancelledTo === null
                  ? []
                  : [{ label: 'Gekündigt zum', value: date(contract.cancelledTo) }]),
                {
                  label: 'Läuft bis',
                  value:
                    contract.runsUntil === null
                      ? contractWords.unlimited
                      : date(contract.runsUntil),
                },
                {
                  label: 'Kündigungsfrist',
                  value: noticeWords(contract) ?? 'keine',
                },
                ...(contract.noticeBy === null
                  ? []
                  : [{ label: 'Kündigung bis', value: date(contract.noticeBy) }]),
              ]}
            />
            {contract.standing === 'renews' && contract.runsUntil !== null ? (
              <NoteBox tone="waiting">
                {`Die Kündigung zum ${date(contract.runsUntil)} war bis zum ${date(contract.noticeBy ?? contract.runsUntil)} möglich. Der Vertrag verlängert sich danach um ${String(contract.renewalMonths)} ${contract.renewalMonths === 1 ? 'Monat' : 'Monate'}.`}
              </NoteBox>
            ) : null}
          </Card>
          <Card title="Angaben">
            <FactList
              keyWidth={100}
              facts={[
                {
                  label: 'Fremdfirma',
                  value: (
                    <Link to={contractorPlaces.contractor(contract.contractorId)}>
                      {firmNames.get(contract.contractorId) ?? contract.contractorName}
                    </Link>
                  ),
                },
                { label: 'Reaktionszeit', value: contract.responseTime ?? '' },
                { label: 'Preis', value: contract.price ?? '' },
                { label: 'Notiz', value: contract.note ?? '' },
              ]}
            />
          </Card>
          {/* The contract on paper and what came after it (#329), each with its file as the board shows it. */}
          <DocumentsCard
            place={{ propertyId: null, contractId: contract.id }}
            at={`Vertrag ${contract.title}`}
            files={changes}
          />
        </div>
        <div className="flex flex-col gap-3.5">
          <TablePanel
            title="Erfasst"
            caption="Gebäude und Anlagen, die dieser Vertrag erfasst"
            {...(changes
              ? {
                  action: (
                    <Button
                      size="small"
                      icon={Plus}
                      onClick={() => {
                        setCovering(true)
                      }}
                    >
                      Erfassen
                    </Button>
                  ),
                }
              : {})}
            note={contractWords.coveredNote}
            cards={items.map((item) => ({
              key: item.id,
              title:
                item.kind === 'asset' && item.assetId !== null ? (
                  <Link to={officePlaces.asset(item.assetId)}>{item.name}</Link>
                ) : item.buildingId !== null ? (
                  <Link to={officePlaces.building(item.buildingId)}>{item.name}</Link>
                ) : (
                  item.name
                ),
              sub: item.where,
            }))}
          >
            <thead>
              <tr>
                <Column className="min-w-[220px]">Gebäude oder Anlage</Column>
                <Column className="w-[260px] min-w-[160px]">Ort</Column>
                {changes ? (
                  <Column className="w-[90px]" align="right">
                    <span className="sr-only">Entfernen</span>
                  </Column>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <Cell colSpan={changes ? 3 : 2}>
                    <span className="text-ink-faint">{contractWords.nothingCovered}</span>
                  </Cell>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <Cell>
                      <div className="leading-[1.32]">
                        {item.kind === 'asset' && item.assetId !== null ? (
                          <Link to={officePlaces.asset(item.assetId)} className="font-medium">
                            {item.name}
                          </Link>
                        ) : item.buildingId !== null ? (
                          <Link to={officePlaces.building(item.buildingId)} className="font-medium">
                            {item.name}
                          </Link>
                        ) : (
                          item.name
                        )}
                        <div className="text-[12px] text-ink-faint">
                          {item.kind === 'asset' ? 'Anlage' : 'Gebäude'}
                        </div>
                      </div>
                    </Cell>
                    <Cell>
                      <span className="text-ink-muted">
                        {item.kind === 'building' ? 'ganzes Gebäude' : item.where}
                      </span>
                    </Cell>
                    {changes ? (
                      <Cell align="right">
                        <Button
                          size="small"
                          tone="quiet"
                          aria-label={`${item.name} nicht mehr erfassen`}
                          onClick={() => {
                            void uncover(item.id)
                          }}
                        >
                          Entfernen
                        </Button>
                      </Cell>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </TablePanel>
          {readsDuties ? (
            <TablePanel
              title="Pflichten, die er erfüllt"
              caption="Offene Pflichten, die dieser Vertrag erfüllt"
              note={
                <span className="flex flex-wrap gap-x-3">
                  <span>{contractWords.dutiesNote}</span>
                  <span className="grow" />
                  <Link
                    to={dutyRegisterPlace.to}
                    search={{ [dutyRegisterWords.contractId]: contract.id }}
                  >
                    Alle im Pflichtenverzeichnis
                  </Link>
                </span>
              }
              cards={duties.map((duty) => ({
                key: duty.id,
                title: <Link to={dutyPlaces.duty(duty.id)}>{duty.title}</Link>,
                sub: duty.asset === null ? '' : `${duty.asset.number} ${duty.asset.name}`,
              }))}
            >
              <thead>
                <tr>
                  <Column className="min-w-[220px]">Pflicht</Column>
                  <Column className="w-[250px] min-w-[160px]">Anlage</Column>
                  <Column className="w-[170px] min-w-[140px]">Termin</Column>
                </tr>
              </thead>
              <tbody>
                {duties.length === 0 ? (
                  <tr>
                    <Cell colSpan={3}>
                      <span className="text-ink-faint">{contractWords.noDuty}</span>
                    </Cell>
                  </tr>
                ) : (
                  duties.map((duty) => (
                    <tr key={duty.id}>
                      <Cell>
                        <Link to={dutyPlaces.duty(duty.id)}>{duty.title}</Link>
                      </Cell>
                      <Cell>
                        {duty.asset === null ? '' : `${duty.asset.number} ${duty.asset.name}`}
                      </Cell>
                      <Cell>
                        {duty.contractEnded ? (
                          <Status tone="conflict" icon={TriangleAlert}>
                            Vertrag abgelaufen
                          </Status>
                        ) : duty.appointment === null ? (
                          ''
                        ) : (
                          date(duty.appointment.dueOn)
                        )}
                      </Cell>
                    </tr>
                  ))
                )}
              </tbody>
            </TablePanel>
          ) : null}
        </div>
      </div>
      {editing ? (
        <ContractDialog
          contract={contract}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : null}
      {covering ? (
        <CoverDialog
          contractId={contract.id}
          onClose={() => {
            setCovering(false)
          }}
        />
      ) : null}
      <Confirm
        open={removing}
        title={`${contract.title} entfernen?`}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          void remove()
        }}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        {contractWords.removal}
      </Confirm>
    </Screen>
  )
}
