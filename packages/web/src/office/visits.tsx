import type {
  BriefingEntry,
  ContractorVisits,
  FormField,
  WorkPermitEntry,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Panel,
  TablePanel,
} from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import { FactList } from '@opengewerk/platform-web/office'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { useState } from 'react'

import { SignatureMark } from '../app/signature-ways.js'
import { workOrderPlaces } from './work-order-addresses.js'

/**
 * A contractor at work in the office (section 4.11 of the concept, #330, the
 * boards "Auftrag einer Fremdfirma", "Einweisung" and "Erlaubnisschein"): the
 * briefings and permits for hot work at a work order and at a firm. Taken on
 * site; read here and changed nowhere. A permit is shown in the version of
 * its form it was made in. Fetched when a page shows it, no part of the
 * entry of the office, which has a budget (`scripts/budget.js`).
 */
export const visitWords = {
  briefings: 'Einweisungen',
  permits: 'Erlaubnisscheine',
  briefed: 'Eingewiesen',
  permit: 'Erlaubnisschein',
  at: 'Am',
  issuedAt: 'Ausgestellt',
  briefedBy: (name: string) => `eingewiesen von ${name}`,
  briefingNote:
    'Aufgenommen vor Ort, mit der Unterschrift der eingewiesenen Person. Eine Einweisung gilt für diesen Auftrag.',
  permitNote:
    'Formular aus dem Paket Brandschutz. Ein Erlaubnisschein bleibt in der Fassung lesbar, in der er entstand.',
  noBriefing: 'Noch niemand eingewiesen. Eingewiesen wird vor Ort, auf dem Gerät.',
  noPermit: 'Kein Erlaubnisschein. Ausgestellt wird er vor Ort, auf dem Gerät.',
  show: 'Ansehen',
  showOf: (what: string) => `${what} ansehen`,
  briefingOf: (name: string) => `Einweisung von ${name}`,
  permitFor: (name: string | null) => (name === null ? 'ohne Unterschrift' : `für ${name}`),
  order: 'Auftrag',
  firm: 'Fremdfirma',
  when: 'Eingewiesen',
  subject: 'Worin',
  briefedPerson: 'eingewiesene Person',
  briefingCovered: (name: string) =>
    `Aufgenommen auf dem Gerät von ${name}. Die Einweisung nennt dieses Konto und lässt sich nicht mehr ändern.`,
  permitVersion: (version: number, at: string, name: string) =>
    `Formular aus dem Paket Brandschutz, Fassung ${String(version)}. Ausgestellt am ${moment(at)} auf dem Gerät von ${name}; der Erlaubnisschein nennt dieses Konto und lässt sich nicht mehr ändern.`,
  unknownVersion: (version: number) =>
    `Die Fassung ${String(version)} dieses Formulars kennt der Katalog dieses Servers nicht. Die Angaben stehen hier mit ihren Schlüsseln.`,
  yes: 'Ja',
  no: 'Nein',
  close: 'Schließen',
  atFirm: 'Einweisungen und Erlaubnisscheine',
  atFirmCaption: 'Einweisungen und Erlaubnisscheine an den Aufträgen dieser Firma',
  what: 'Was',
  noneAtFirm: 'Noch keine Einweisung und kein Erlaubnisschein an einem Auftrag dieser Firma.',
  briefing: 'Einweisung',
  failed: 'Die Einweisungen und Erlaubnisscheine kommen vom Server, mit Verbindung.',
} as const

const visitKey = ['visits'] as const

function orderVisitsQuery(orderId: string) {
  return {
    queryKey: [...visitKey, 'order', orderId],
    queryFn: () => request<ContractorVisits>(`/work-orders/${encodeURIComponent(orderId)}/visits`),
  } as const
}

function firmVisitsQuery(contractorId: string) {
  return {
    queryKey: [...visitKey, 'firm', contractorId],
    queryFn: () =>
      request<ContractorVisits>(`/contractors/${encodeURIComponent(contractorId)}/visits`),
  } as const
}

/** A drawing with the name of whoever made it beside it. */
function Signed({
  name,
  path,
  meta,
}: {
  readonly name: string
  readonly path: string
  readonly meta: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[180px] shrink-0 rounded-control border border-line bg-surface p-1 max-sm:w-[120px]">
        <SignatureMark name={name} path={path} typedName={null} />
      </div>
      <div className="min-w-0 leading-[1.4]">
        <div className="font-semibold">{name}</div>
        <div className="text-[13px] text-ink-muted">{meta}</div>
      </div>
    </div>
  )
}

/** A briefing as it was signed: whom, in what, the drawing, and the account whose device took it. */
function BriefingDialog({
  briefing,
  onClose,
}: {
  readonly briefing: BriefingEntry
  readonly onClose: () => void
}) {
  return (
    <Dialog title={visitWords.briefingOf(briefing.personName)} width={600} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <FactList
          keyWidth={110}
          facts={[
            {
              label: visitWords.order,
              value: [briefing.orderNumber, briefing.orderTitle].filter(Boolean).join(' '),
            },
            { label: visitWords.firm, value: briefing.contractorName },
            { label: visitWords.when, value: `am ${moment(briefing.signedAt)}` },
            { label: visitWords.subject, value: briefing.subject },
          ]}
        />
        <Signed
          name={briefing.personName}
          path={briefing.path}
          meta={`${visitWords.briefedPerson}, mit Schriftzug`}
        />
        <p className="text-[12px] leading-[1.45] text-ink-muted">
          {visitWords.briefingCovered(briefing.signedByName)}
        </p>
      </div>
      <DialogActions>
        <Button onClick={onClose}>{visitWords.close}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** What was entered in a field of a permit, in words. */
function answerText(field: FormField, value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (field.kind === 'choice') {
    return field.options.find((option) => option.value === value)?.label ?? String(value)
  }

  if (field.kind === 'yes_no') {
    return value === true ? visitWords.yes : visitWords.no
  }

  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isSigned(value: unknown): value is { readonly name: string; readonly path: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly name?: unknown }).name === 'string' &&
    typeof (value as { readonly path?: unknown }).path === 'string'
  )
}

/** A permit in the version of its form it was made in, section by section. */
function PermitDialog({
  permit,
  onClose,
}: {
  readonly permit: WorkPermitEntry
  readonly onClose: () => void
}) {
  const form = permit.form

  return (
    <Dialog
      title={form?.title ?? visitWords.permit}
      sub={[permit.orderNumber, permit.orderTitle].filter(Boolean).join(' ')}
      width={640}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-[12px] leading-[1.45] text-ink-muted">
          {visitWords.permitVersion(permit.formVersion, permit.signedAt, permit.signedByName)}
        </p>
        {form === null ? (
          <>
            <p className="text-[13px] leading-[1.45]">
              {visitWords.unknownVersion(permit.formVersion)}
            </p>
            <FactList
              keyWidth={140}
              facts={Object.entries(permit.answers).map(([key, value]) => ({
                label: key,
                value: isSigned(value)
                  ? value.name
                  : typeof value === 'string'
                    ? value
                    : JSON.stringify(value),
              }))}
            />
          </>
        ) : (
          form.sections.map((section) => {
            const signatures = section.fields.filter((field) => field.kind === 'signature')
            const others = section.fields.filter((field) => field.kind !== 'signature')

            return (
              <section
                key={section.key}
                aria-label={section.title}
                className="flex flex-col gap-1.5"
              >
                <h3 className="text-[13px] font-semibold">{section.title}</h3>
                {others.length === 0 ? null : (
                  <FactList
                    keyWidth={140}
                    facts={others.map((field) => ({
                      label: field.label,
                      value: answerText(field, permit.answers[field.key]),
                    }))}
                  />
                )}
                {signatures.map((field) => {
                  const value = permit.answers[field.key]

                  return isSigned(value) ? (
                    <Signed
                      key={field.key}
                      name={value.name}
                      path={value.path}
                      meta={`${field.label}, mit Schriftzug`}
                    />
                  ) : null
                })}
              </section>
            )
          })
        )}
      </div>
      <DialogActions>
        <Button onClick={onClose}>{visitWords.close}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** A panel in place of a table that has no row yet. */
function Empty({ title, said }: { readonly title: string; readonly said: string }) {
  return (
    <Panel title={title}>
      <p className="text-[13px] leading-[1.45] text-ink-muted">{said}</p>
    </Panel>
  )
}

type Open = { readonly briefing: BriefingEntry } | { readonly permit: WorkPermitEntry } | null

function Opened({ open, onClose }: { readonly open: Open; readonly onClose: () => void }) {
  if (open === null) {
    return null
  }

  return 'briefing' in open ? (
    <BriefingDialog briefing={open.briefing} onClose={onClose} />
  ) : (
    <PermitDialog permit={open.permit} onClose={onClose} />
  )
}

/**
 * The briefings and permits at a work order: shown where a firm of the list
 * carries it out, or where there are some.
 */
export function OrderVisits({
  orderId,
  named,
}: {
  readonly orderId: string
  readonly named: boolean
}) {
  const visits = useQuery(orderVisitsQuery(orderId))
  const [open, setOpen] = useState<Open>(null)
  const briefings = visits.data?.briefings ?? []
  const permits = visits.data?.permits ?? []

  if (!named && briefings.length === 0 && permits.length === 0) {
    return null
  }

  return (
    <>
      {briefings.length === 0 ? (
        <Empty
          title={visitWords.briefings}
          said={visits.isError ? visitWords.failed : visitWords.noBriefing}
        />
      ) : (
        <TablePanel
          title={visitWords.briefings}
          caption={visitWords.briefings}
          note={visitWords.briefingNote}
          cards={briefings.map((briefing) => ({
            key: briefing.id,
            title: briefing.personName,
            sub: `${visitWords.briefedBy(briefing.signedByName)} · ${moment(briefing.signedAt)}`,
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[200px]">{visitWords.briefed}</Column>
              <Column className="w-[150px] min-w-[140px]">{visitWords.at}</Column>
              <Column className="w-[110px] min-w-[100px]" align="right">
                <span className="sr-only">{visitWords.show}</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {briefings.map((briefing) => (
              <tr key={briefing.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <div className="font-medium">{briefing.personName}</div>
                    <div className="text-[12px] text-ink-faint">
                      {visitWords.briefedBy(briefing.signedByName)}
                    </div>
                  </div>
                </Cell>
                <Cell>{moment(briefing.signedAt)}</Cell>
                <Cell className="text-right">
                  <Button
                    size="small"
                    icon={Eye}
                    aria-label={visitWords.showOf(visitWords.briefingOf(briefing.personName))}
                    onClick={() => {
                      setOpen({ briefing })
                    }}
                  >
                    {visitWords.show}
                  </Button>
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {permits.length === 0 ? (
        <Empty
          title={visitWords.permits}
          said={visits.isError ? visitWords.failed : visitWords.noPermit}
        />
      ) : (
        <TablePanel
          title={visitWords.permits}
          caption={visitWords.permits}
          note={visitWords.permitNote}
          cards={permits.map((permit) => ({
            key: permit.id,
            title: permit.form?.title ?? visitWords.permit,
            sub: `${visitWords.permitFor(permit.signerName)} · ${moment(permit.signedAt)}`,
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[200px]">{visitWords.permit}</Column>
              <Column className="w-[150px] min-w-[140px]">{visitWords.issuedAt}</Column>
              <Column className="w-[110px] min-w-[100px]" align="right">
                <span className="sr-only">{visitWords.show}</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {permits.map((permit) => (
              <tr key={permit.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <div className="font-medium">{permit.form?.title ?? visitWords.permit}</div>
                    <div className="text-[12px] text-ink-faint">
                      {visitWords.permitFor(permit.signerName)}
                    </div>
                  </div>
                </Cell>
                <Cell>{moment(permit.signedAt)}</Cell>
                <Cell className="text-right">
                  <Button
                    size="small"
                    icon={Eye}
                    aria-label={visitWords.showOf(permit.form?.title ?? visitWords.permit)}
                    onClick={() => {
                      setOpen({ permit })
                    }}
                  >
                    {visitWords.show}
                  </Button>
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <Opened
        open={open}
        onClose={() => {
          setOpen(null)
        }}
      />
    </>
  )
}

/** The briefings and permits at the orders of a firm, the latest first, each with its order. */
export function FirmVisits({ contractorId }: { readonly contractorId: string }) {
  const visits = useQuery(firmVisitsQuery(contractorId))
  const [open, setOpen] = useState<Open>(null)
  const rows = [
    ...(visits.data?.briefings ?? []).map((briefing) => ({
      key: briefing.id,
      what: visitWords.briefing,
      who: briefing.personName,
      order: briefing,
      at: briefing.signedAt,
      open: { briefing } as const,
    })),
    ...(visits.data?.permits ?? []).map((permit) => ({
      key: permit.id,
      what: permit.form?.title ?? visitWords.permit,
      who: visitWords.permitFor(permit.signerName),
      order: permit,
      at: permit.signedAt,
      open: { permit } as const,
    })),
  ].sort((left, right) => (left.at < right.at ? 1 : -1))

  return (
    <>
      {rows.length === 0 ? (
        <Empty
          title={visitWords.atFirm}
          said={visits.isError ? visitWords.failed : visitWords.noneAtFirm}
        />
      ) : (
        <TablePanel
          title={visitWords.atFirm}
          caption={visitWords.atFirmCaption}
          cards={rows.map((row) => ({
            key: row.key,
            title: `${row.what}: ${row.who}`,
            sub: [row.order.orderNumber, row.order.orderTitle, moment(row.at)]
              .filter(Boolean)
              .join(' · '),
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[180px]">{visitWords.what}</Column>
              <Column className="w-[250px] min-w-[200px]">{visitWords.order}</Column>
              <Column className="w-[150px] min-w-[140px]">{visitWords.at}</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <Cell>
                  <div className="leading-[1.32]">
                    <button
                      type="button"
                      className="text-left font-medium text-link underline-offset-2 hover:underline"
                      onClick={() => {
                        setOpen(row.open)
                      }}
                    >
                      {row.what}
                    </button>
                    <div className="text-[12px] text-ink-faint">{row.who}</div>
                  </div>
                </Cell>
                <Cell>
                  <div className="leading-[1.32]">
                    <Link to={workOrderPlaces.order(row.order.activityId)} className="font-medium">
                      {row.order.orderNumber ?? row.order.orderTitle}
                    </Link>
                    {row.order.orderNumber === null ? null : (
                      <div className="text-[12px] text-ink-faint">{row.order.orderTitle}</div>
                    )}
                  </div>
                </Cell>
                <Cell>{moment(row.at)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <Opened
        open={open}
        onClose={() => {
          setOpen(null)
        }}
      />
    </>
  )
}
