import {
  type ActivityList,
  activityStatusLabel,
  type ContractEntry,
  contractorServices,
  contractorServicesWords,
  contractStandingLabel,
  type DutyRegister,
  evidenceResultLabel,
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
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useDeferredValue, useState } from 'react'

import { askAt } from '../../sync/made-at.js'

// The briefings and permits of a firm (#330) are fetched when its page shows
// them and are no part of the entry of the office, which has a budget
// (`scripts/budget.js`).
const FirmVisits = lazy(async () => ({ default: (await import('../visits.js')).FirmVisits }))
import { activityPlaces } from '../activity-addresses.js'
import {
  contractorKey,
  contractorListQuery,
  contractorNamesQuery,
  contractorPlaces,
  contractorQuery,
} from '../contractor-addresses.js'
import { ContractorContacts } from '../contractor-contacts.js'
import { ContractorDialog, TakeoverDialog, useServiceWords } from '../contractor-dialogs.js'
import { contractPlaces, firmContractsQuery } from '../contract-addresses.js'
import { DocumentsCard } from '../documents.js'
import { factLink } from '../links.js'
import {
  dutyPlaces,
  dutyRegisterPlace,
  dutyRegisterRequest,
  dutyRegisterWords,
  evidencePlaces,
} from '../duty-addresses.js'

/**
 * The contractors of the operator in the office (#328, 4.11 of the concept),
 * as the boards "Fremdfirmen" and "Eine Fremdfirma" draw them: the list with
 * the services and the open duties of each firm, the names that stand as
 * text at duties to take over, and the page of a firm with its address,
 * services and note, its open duties and the evidence of its reports.
 * Tenant-wide and without an area (2.8). Every role looks at them; the
 * Leitung and the Technische Leitung keep them ("Fremdfirmen pflegen").
 */

export const contractorWords = {
  sub: 'Firmen, die Pflichten ausführen, mit Ansprechpartnern und Leistungen. Betreiberweit, ohne Bereich.',
  loading: 'Wird geladen.',
  failed: 'Die Fremdfirmen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  noConnection: 'Ohne Verbindung. Die Fremdfirmen kommen vom Server.',
  none: 'Noch keine Fremdfirma. Legen Sie eine an, oder übernehmen Sie die Namen, die an Pflichten stehen.',
  noneFound: 'Keine Fremdfirma passt zur Suche.',
  searchLabel: 'Suche',
  serviceLabel: 'Leistung',
  everyService: 'Alle Leistungen',
  searchPlaceholder: 'Name oder Ort',
  listNote:
    'Eine Firma, die nicht mehr arbeitet, wird entfernt und bleibt an jedem Nachweis lesbar, wie er geschrieben wurde.',
  takeoverButton: 'Namen übernehmen',
  removed:
    'Entfernt. Die Firma steht in keiner Auswahl mehr und bleibt lesbar, wo sie genannt ist.',
  removal:
    'Entfernt wird eine Firma nur aus der Auswahl. An Nachweisen und Aufträgen bleibt sie lesbar.',
  removalKeeps:
    'Entfernt wird eine Firma nur aus der Auswahl. An Nachweisen und Aufträgen bleibt sie lesbar.',
  noDuty: 'Keine offene Pflicht nennt diese Firma.',
  noEvidence: 'Noch kein Nachweis aus einem Bericht dieser Firma.',
  noOrder: 'Kein offener Vorgang nennt diese Firma.',
  noAddress: 'nicht angegeben',
} as const

/** "An 3 Pflichten steht eine Fremdfirma noch als Text: „A“ (2 Pflichten) und „B“ (1 Pflicht)." */
export function takeoverSentence(names: readonly { name: string; duties: number }[]): string {
  const total = names.reduce((sum, each) => sum + each.duties, 0)
  const parts = names.map(
    (each) =>
      `„${each.name}“ (${each.duties === 1 ? '1 Pflicht' : `${String(each.duties)} Pflichten`})`,
  )
  const listed =
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}`

  return `An ${total === 1 ? 'einer Pflicht' : `${String(total)} Pflichten`} steht eine Fremdfirma noch als Text: ${listed}. Übernehmen Sie sie in die Liste, dann wählen die Pflichten sie aus.`
}

/** Why a firm cannot be removed yet: what still names it, and what to do. */
export function blockedSentence(duties: number, activities: number): string {
  const parts = [
    duties === 0 ? null : duties === 1 ? '1 offene Pflicht' : `${String(duties)} offene Pflichten`,
    activities === 0
      ? null
      : activities === 1
        ? '1 offener Vorgang'
        : `${String(activities)} offene Vorgänge`,
  ].filter((part) => part !== null)

  return `Solange eine offene Pflicht oder ein offener Vorgang die Firma nennt, lässt sie sich nicht entfernen. ${parts.join(' und ')} ${duties + activities === 1 ? 'nennt' : 'nennen'} sie; wählen Sie dort eine andere Firma oder die eigenen Leute.`
}

function Loading({ failed, paused }: { readonly failed: boolean; readonly paused: boolean }) {
  return (
    <Panel>
      <Empty>
        {failed
          ? contractorWords.failed
          : paused
            ? contractorWords.noConnection
            : contractorWords.loading}
      </Empty>
    </Panel>
  )
}

const refusedOnce = (count: number, error: Error) => !(error instanceof RequestRefused) && count < 2

/** "68169 Mannheim", or nothing where the firm names no place. */
function placeOf(firm: { postalCode: string | null; city: string | null }): string {
  return [firm.postalCode, firm.city].filter((part) => part !== null && part !== '').join(' ')
}

/**
 * "Fremdfirmen", `fremdfirmen()` of the boards: every firm with where it
 * sits, its services and how many open duties name it, searched by name and
 * place. Whoever keeps the firms makes one and takes the names over that
 * stand as text at duties.
 */
export function ContractorListScreen() {
  const keeps = useRight('contractor.write')
  const [search, setSearch] = useState('')
  const [service, setService] = useState('')
  const wanted = useDeferredValue(search.trim().toLocaleLowerCase('de'))
  const words = useServiceWords()
  const [making, setMaking] = useState(false)
  const [takingOver, setTakingOver] = useState(false)
  const firms = useQuery({ ...contractorListQuery, retry: refusedOnce })
  const names = useQuery({ ...contractorNamesQuery, enabled: keeps, retry: refusedOnce })
  const table = useTableExport('/contractors/table')
  const all = firms.data ?? []
  const rows = all.filter(
    (firm) =>
      (service === '' || firm.services.includes(service)) &&
      (wanted === '' ||
        [firm.name, placeOf(firm)].some((text) => text.toLocaleLowerCase('de').includes(wanted))),
  )
  const offered = names.data ?? []

  return (
    <Screen>
      <PageHead
        title="Fremdfirmen"
        {...(firms.data === undefined
          ? {}
          : { count: all.length === 1 ? '1 Firma' : `${String(all.length)} Firmen` })}
        sub={contractorWords.sub}
      />
      {keeps && offered.length > 0 ? (
        <NoteBox
          tone="waiting"
          action={
            <Button
              size="small"
              onClick={() => {
                setTakingOver(true)
              }}
            >
              {contractorWords.takeoverButton}
            </Button>
          }
        >
          {takeoverSentence(offered)}
        </NoteBox>
      ) : null}
      {table.trouble}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div className="w-[280px] max-lg:w-full">
          <Field
            label={contractorWords.searchLabel}
            type="search"
            value={search}
            placeholder={contractorWords.searchPlaceholder}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <div className="w-[260px] max-lg:w-full">
          <SelectField
            label={contractorWords.serviceLabel}
            value={service}
            options={[
              { value: '', label: contractorWords.everyService },
              ...contractorServices.map((each) => ({ value: each, label: words(each) })),
            ]}
            onChange={setService}
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
              Fremdfirma anlegen
            </Button>
          ) : null}
        </div>
      </div>
      {firms.data === undefined ? (
        <Loading failed={firms.isError} paused={firms.fetchStatus === 'paused'} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>{all.length === 0 ? contractorWords.none : contractorWords.noneFound}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Fremdfirmen mit Ort, Leistungen und offenen Pflichten"
          note={contractorWords.listNote}
          cards={rows.map((firm) => ({
            key: firm.id,
            title: <Link to={contractorPlaces.contractor(firm.id)}>{firm.name}</Link>,
            sub: [placeOf(firm), contractorServicesWords(firm.services)]
              .filter((part) => part !== '')
              .join(' · '),
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[220px]">Firma</Column>
              <Column className="w-[260px] min-w-[180px]">Leistungen</Column>
              <Column className="w-[140px] min-w-[120px]" align="right">
                Offene Pflichten
              </Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((firm) => (
              <tr key={firm.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <Link to={contractorPlaces.contractor(firm.id)} className="font-medium">
                      {firm.name}
                    </Link>
                    {placeOf(firm) === '' ? null : (
                      <div className="text-[12px] text-ink-faint">{placeOf(firm)}</div>
                    )}
                  </div>
                </Cell>
                <Cell>{contractorServicesWords(firm.services)}</Cell>
                <Cell align="right">
                  <span className="font-semibold">{firm.openDuties}</span>
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {making ? (
        <ContractorDialog
          onClose={() => {
            setMaking(false)
          }}
        />
      ) : null}
      {takingOver ? (
        <TakeoverDialog
          names={offered}
          onClose={() => {
            setTakingOver(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** "1 Anlage", "3 Anlagen". */
function counted(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`
}

/** "läuft bis 31.12.2027, 2 Gebäude, 3 Anlagen", or how a contract stands that does not run. */
function contractWords(contract: ContractEntry): string {
  return [
    contract.standing === 'running' && contract.runsUntil !== null
      ? `läuft bis ${date(contract.runsUntil)}`
      : contractStandingLabel[contract.standing],
    contract.buildings === 0 ? null : counted(contract.buildings, 'Gebäude', 'Gebäude'),
    contract.assets === 0 ? null : counted(contract.assets, 'Anlage', 'Anlagen'),
  ]
    .filter((part) => part !== null)
    .join(', ')
}

/** The contracts of a firm, each to its page (#570). */
function ContractsCard({ contractorId }: { readonly contractorId: string }) {
  const contracts = useQuery({ ...firmContractsQuery(contractorId), retry: refusedOnce })

  return (
    <Card title="Verträge">
      {contracts.data === undefined ? null : contracts.data.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Kein Vertrag mit dieser Firma.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {contracts.data.map((contract) => (
            <li key={contract.id} className="leading-[1.35]">
              <Link
                to={contractPlaces.contract(contract.id)}
                className={`text-[13px] font-medium ${factLink}`}
              >
                {contract.title}
              </Link>
              <div className="text-[12px] text-ink-faint">{contractWords(contract)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
 * The page of a firm, `fremdfirma()` of the boards: its address, its
 * services and note, the open duties that name it, and the evidence of its
 * reports, each with the organisation as it was written. A removed firm keeps
 * its page, so that what named it leads somewhere.
 */
export function ContractorScreen() {
  const { contractorId } = useParams({ strict: false }) as { contractorId: string }
  const keeps = useRight('contractor.write')
  const readsDuties = useRight('duty.read')
  const readsEvidence = useRight('evidence.read')
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const words = useServiceWords()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const page = useQuery({ ...contractorQuery(contractorId), retry: refusedOnce })
  const duties = useQuery({
    queryKey: [...contractorKey, 'duties', contractorId],
    queryFn: () => request<DutyRegister>(dutyRegisterRequest({ contractorId }, 0, 5)),
    enabled: readsDuties,
  })
  // The activities still to be done that the firm carries out (#328).
  const readsActivities = useRight('activity.read')
  const readsContracts = useRight('contract.read')
  const orders = useQuery({
    queryKey: [...contractorKey, 'activities', contractorId],
    queryFn: () =>
      request<ActivityList>(
        `/activities?state=pending&contractor=${encodeURIComponent(contractorId)}&offset=0&limit=5`,
      ),
    enabled: readsActivities,
  })
  const shownOrders = orders.data?.activities ?? []

  if (page.data === undefined) {
    return (
      <Screen>
        <PageHead
          title="Fremdfirma"
          crumbs={[{ to: contractorPlaces.list, label: 'Fremdfirmen' }]}
        />
        <Loading failed={page.isError} paused={page.fetchStatus === 'paused'} />
      </Screen>
    )
  }

  const { contractor, openDuties, evidence } = page.data
  const blocking = openDuties + page.data.openActivities
  const removed = contractor.deletedAt !== null

  async function remove() {
    setTrouble(null)

    const result = await askAt(
      client,
      'DELETE',
      `/contractors/${encodeURIComponent(contractor.id)}`,
      contractor.id,
    )

    setRemoving(false)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await queries.invalidateQueries({ queryKey: contractorKey })
    void navigate({ to: contractorPlaces.list })
  }

  return (
    <Screen>
      <PageHead
        title={contractor.name}
        crumbs={[{ to: contractorPlaces.list, label: 'Fremdfirmen' }]}
        sub="Fremdfirma"
        actions={
          <>
            <ChangesButton table="contractors" id={contractor.id} />
            {keeps && !removed ? (
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
      {removed ? <NoteBox tone="neutral">{contractorWords.removed}</NoteBox> : null}
      {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
      <div className="grid items-start gap-3.5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <Card title="Anschrift">
            <FactList
              keyWidth={90}
              facts={[
                { label: 'Straße', value: contractor.street ?? '' },
                { label: 'Ort', value: placeOf(contractor) },
                { label: 'Telefon', value: contractor.phone ?? '' },
                { label: 'E-Mail', value: contractor.email ?? '' },
              ]}
            />
          </Card>
          <ContractorContacts contractorId={contractor.id} removed={removed} />
          <Card title="Leistungen und Notiz">
            {contractor.services.length === 0 ? (
              <p className="text-[13px] text-ink-faint">Keine Leistung angegeben.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {[...contractor.services].sort().map((service) => (
                  <li key={service}>{words(service)}</li>
                ))}
              </ul>
            )}
            {contractor.note === null ? null : (
              <p className="text-[12px] whitespace-pre-line text-ink-faint">{contractor.note}</p>
            )}
          </Card>
          {/* Its certificates and insurance, with their date as a deadline (#328, #327). */}
          <DocumentsCard
            place={{ propertyId: null, contractorId: contractor.id }}
            at={`Fremdfirma ${contractor.name}`}
            files={keeps && !removed}
            says="validity"
          />
          {/* Its contracts, for whoever reads contracts (#328, #570). */}
          {readsContracts ? <ContractsCard contractorId={contractor.id} /> : null}
        </div>
        <div className="flex flex-col gap-3.5">
          {readsDuties ? (
            <TablePanel
              title="Pflichten"
              caption="Offene Pflichten, die diese Firma ausführt"
              note={
                <span className="flex flex-wrap gap-x-3">
                  <span>
                    {openDuties === 1
                      ? '1 offene Pflicht'
                      : `${String(openDuties)} offene Pflichten`}
                  </span>
                  <span className="grow" />
                  <Link
                    to={dutyRegisterPlace.to}
                    search={{ [dutyRegisterWords.contractorId]: contractor.id }}
                  >
                    Alle im Pflichtenverzeichnis
                  </Link>
                </span>
              }
              cards={(duties.data?.duties ?? []).map((duty) => ({
                key: duty.id,
                title: <Link to={dutyPlaces.duty(duty.id)}>{duty.title}</Link>,
                sub: duty.appointment === null ? '' : date(duty.appointment.dueOn),
              }))}
            >
              <thead>
                <tr>
                  <Column className="min-w-[220px]">Pflicht</Column>
                  <Column className="w-[220px] min-w-[160px]">Anlage</Column>
                  <Column className="w-[110px] min-w-[100px]">Termin</Column>
                </tr>
              </thead>
              <tbody>
                {(duties.data?.duties ?? []).length === 0 ? (
                  <tr>
                    <Cell colSpan={3}>
                      <span className="text-ink-faint">{contractorWords.noDuty}</span>
                    </Cell>
                  </tr>
                ) : (
                  (duties.data?.duties ?? []).map((duty) => (
                    <tr key={duty.id}>
                      <Cell>
                        <Link to={dutyPlaces.duty(duty.id)}>{duty.title}</Link>
                      </Cell>
                      <Cell>
                        {duty.asset === null ? '' : `${duty.asset.number} ${duty.asset.name}`}
                      </Cell>
                      <Cell>{duty.appointment === null ? '' : date(duty.appointment.dueOn)}</Cell>
                    </tr>
                  ))
                )}
              </tbody>
            </TablePanel>
          ) : null}
          {readsActivities ? (
            <TablePanel
              title="Aufträge"
              caption="Offene Vorgänge, die diese Firma ausführt"
              cards={shownOrders.map((order) => ({
                key: order.id,
                title: <Link to={activityPlaces.activity(order.id)}>{order.title}</Link>,
                sub: [
                  order.dueOn === null ? null : date(order.dueOn),
                  activityStatusLabel[order.status],
                ]
                  .filter(Boolean)
                  .join(' · '),
              }))}
            >
              <thead>
                <tr>
                  <Column className="min-w-[240px]">Auftrag</Column>
                  <Column className="w-[110px] min-w-[100px]">Termin</Column>
                  <Column className="w-[140px] min-w-[120px]">Zustand</Column>
                </tr>
              </thead>
              <tbody>
                {shownOrders.length === 0 ? (
                  <tr>
                    <Cell colSpan={3}>
                      <span className="text-ink-faint">{contractorWords.noOrder}</span>
                    </Cell>
                  </tr>
                ) : (
                  shownOrders.map((order) => (
                    <tr key={order.id}>
                      <Cell>
                        <Link to={activityPlaces.activity(order.id)}>{order.title}</Link>
                      </Cell>
                      <Cell>{order.dueOn === null ? '' : date(order.dueOn)}</Cell>
                      <Cell>{activityStatusLabel[order.status]}</Cell>
                    </tr>
                  ))
                )}
              </tbody>
            </TablePanel>
          ) : null}
          {/* The briefings and permits at its orders (#330). */}
          {readsActivities ? (
            <Suspense fallback={null}>
              <FirmVisits contractorId={contractorId} />
            </Suspense>
          ) : null}
          {readsEvidence ? (
            <TablePanel
              title="Nachweise"
              caption="Nachweise aus Berichten dieser Firma, der neueste zuerst"
              cards={evidence.map((each) => ({
                key: each.id,
                title: (
                  <Link to={evidencePlaces.evidence(each.id)}>
                    {`${each.number} ${each.dutyTitle}`}
                  </Link>
                ),
                sub: `${date(each.performedOn)} · ${evidenceResultLabel[each.result]}`,
              }))}
            >
              <thead>
                <tr>
                  <Column className="min-w-[240px]">Nachweis</Column>
                  <Column className="w-[110px] min-w-[100px]">Tag</Column>
                  <Column className="w-[140px] min-w-[120px]">Ergebnis</Column>
                </tr>
              </thead>
              <tbody>
                {evidence.length === 0 ? (
                  <tr>
                    <Cell colSpan={3}>
                      <span className="text-ink-faint">{contractorWords.noEvidence}</span>
                    </Cell>
                  </tr>
                ) : (
                  evidence.map((each) => (
                    <tr key={each.id}>
                      <Cell>
                        <div className="leading-[1.32]">
                          <Link to={evidencePlaces.evidence(each.id)}>
                            {`${each.number} ${each.dutyTitle}`}
                          </Link>
                          {each.examinerOrganisation === null ? null : (
                            <div className="text-[12px] text-ink-faint">
                              {`Organisation: ${each.examinerOrganisation}`}
                            </div>
                          )}
                        </div>
                      </Cell>
                      <Cell>{date(each.performedOn)}</Cell>
                      <Cell>{evidenceResultLabel[each.result]}</Cell>
                    </tr>
                  ))
                )}
              </tbody>
            </TablePanel>
          ) : null}
        </div>
      </div>
      {editing ? (
        <ContractorDialog
          contractor={contractor}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : null}
      {removing && blocking > 0 ? (
        <Dialog
          title={`${contractor.name} entfernen?`}
          width={520}
          onClose={() => {
            setRemoving(false)
          }}
        >
          <p className="text-[14px]">{blockedSentence(openDuties, page.data.openActivities)}</p>
          <p className="mt-2 text-[12px] text-ink-faint">{contractorWords.removalKeeps}</p>
          <DialogActions>
            <Button
              onClick={() => {
                setRemoving(false)
              }}
            >
              Schließen
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
      <Confirm
        open={removing && blocking === 0}
        title={`${contractor.name} entfernen?`}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          void remove()
        }}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        {contractorWords.removal}
      </Confirm>
    </Screen>
  )
}
