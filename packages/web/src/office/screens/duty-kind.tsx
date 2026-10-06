import {
  type Catalogue,
  catalogueOriginLabel,
  type CatalogueRule,
  countingLabel,
  dutyBindingnessLabel,
  type DutyKind,
  type DutyRegister,
  dutyTaskLabel,
  evidenceKindLabel,
  intervalKindLabel,
  qualificationLevelLabel,
  retentionKindLabel,
  reviewMarks,
  ruleScopeNames,
  ruleValueWords,
  scopeOf,
  scopeWords,
} from '@opengewerk/haustechnik-domain'
import { Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { FactList, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Check, History, Info } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Acceptance,
  CheckedOn,
  reviewLine,
  ReviewMarks,
  unacceptedWords,
} from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import { dutyRegisterPlace, dutyRegisterRequest, dutySearch } from '../duty-addresses.js'
import { factLink } from '../links.js'
import { appliesWords, NotInCatalogue } from './catalogue.js'

/**
 * The page of a duty kind, `pflichtart()` of the boards (section 5 of the
 * concept): what it has somebody do, where it comes from and how binding it
 * is, for which assets it comes into question, the rules it runs by with the
 * time each applies in, and who has accepted it and when it was last checked
 * against its source.
 *
 * Shown is the version in force today. Both marks stand beside the title,
 * and every rule in the table carries its own review: a duty kind accepted
 * over an interval nobody has looked at is not one to rely on.
 *
 * The catalogue is the device's and stands without a network. The one card
 * that asks the server is "Bei diesem Betreiber": how many duties this
 * operator has confirmed from the kind, with the way to them in the register
 * of duties (#101), for whoever reads duties. The proposals open and
 * dismissed arrive beside it with the proposals (#102).
 */
export function DutyKindScreen() {
  const { packageName, dutyKey } = useParams({ strict: false }) as {
    packageName?: string
    dutyKey?: string
  }
  const catalogue = useCatalogue()
  const seesDuties = useRight('duty.read')
  const on = today()
  const key = `${packageName ?? ''}.${dutyKey ?? ''}`
  const entry = catalogue?.dutyKind(key, on) ?? null
  const contents = catalogue?.contents(on).find((each) => each.name === packageName)

  if (catalogue === null || entry === null || contents === undefined) {
    return <NotInCatalogue />
  }

  const kind = entry.definition
  const scope = scopeWords(catalogue, kind, on)
  const form = kind.evidence.form
  const marks = reviewMarks(entry.review, on)
  const each = (words: readonly string[], none: string) =>
    words.length === 0 ? none : words.join(', ')

  return (
    <Screen>
      <PageHead
        title={kind.label}
        crumbs={[
          cataloguePlaces.list,
          { to: cataloguePlaces.package(contents.name), label: contents.title },
        ]}
        phoneBack={{ to: cataloguePlaces.package(contents.name), label: contents.title }}
        badges={<ReviewMarks review={entry.review} />}
        sub={`Pflichtart im Paket ${contents.title}, Schlüssel ${entry.key}, Fassung ${String(entry.version)} seit ${date(entry.validFrom)}`}
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Pflichtart">
            <div className="flex flex-col gap-3">
              <Words>{kind.description}</Words>
              <FactList
                keyWidth={120}
                facts={[
                  { label: 'Tätigkeit', value: dutyTaskLabel[kind.task] },
                  { label: 'Herkunft', value: catalogueOriginLabel[kind.origin] },
                  { label: 'Verbindlichkeit', value: dutyBindingnessLabel[kind.bindingness] },
                  { label: 'Fundstelle', value: kind.source },
                  { label: 'Art der Frist', value: intervalKindLabel[kind.interval.kind] },
                  { label: 'Gezählt', value: countingLabel[kind.counting] },
                  {
                    label: 'Qualifikation',
                    value: [
                      qualificationLevelLabel[kind.qualification.level],
                      kind.qualification.note,
                    ]
                      .filter((part) => part !== undefined)
                      .join(', '),
                  },
                  {
                    label: 'Nachweis',
                    value: kind.evidence.kinds.map((each) => evidenceKindLabel[each]).join(', '),
                  },
                  {
                    label: 'Formular',
                    value:
                      form === undefined
                        ? 'keines'
                        : (catalogue.form(form, on)?.definition.title ?? form),
                  },
                  { label: 'Aufbewahrung', value: retentionWords(catalogue, kind, on) },
                ]}
              />
            </div>
          </Panel>
          <Panel title="Geltungsbereich">
            <FactList
              keyWidth={120}
              facts={[
                { label: 'Anlagenart', value: each(scope.assetKinds, 'alle') },
                { label: 'Merkmale', value: each(scope.conditions, 'ohne Einschränkung') },
                { label: 'Gebäudeart', value: each(scope.buildingKinds, 'alle') },
                { label: 'Bundesland', value: each(scope.states, 'bundesweit') },
              ]}
            />
          </Panel>
          <Rules catalogue={catalogue} kind={kind} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Prüfung und Abnahme">
            <div className="flex flex-col gap-2">
              {entry.review.accepted === null ? (
                <>
                  <Finding
                    tone="waiting"
                    icon={<Info size={18} strokeWidth={2.2} aria-hidden="true" />}
                  >
                    {unacceptedWords}
                  </Finding>
                  <Words small>
                    Die fachkundige Abnahme steht aus. Bis dahin sagt jede Stelle, an der diese
                    Pflichtart erscheint, dass sie nicht abgenommen ist.
                  </Words>
                </>
              ) : (
                <Finding
                  tone="done"
                  icon={<Check size={18} strokeWidth={2.2} aria-hidden="true" />}
                >
                  Abgenommen von {entry.review.accepted.by} am {date(entry.review.accepted.on)}
                </Finding>
              )}
              <Finding
                tone={marks.checkedLongAgo ? 'waiting' : 'plain'}
                icon={<History size={18} strokeWidth={2.2} aria-hidden="true" />}
              >
                Zuletzt gegen die Quelle geprüft am {date(entry.review.checkedOn)}
              </Finding>
              {marks.checkedLongAgo ? (
                <Words small>Das liegt mehr als ein Jahr zurück.</Words>
              ) : null}
            </div>
          </Panel>
          {seesDuties ? <AtThisOperator dutyKind={entry.key} /> : null}
        </div>
      </div>
    </Screen>
  )
}

export const atThisOperatorWords = {
  none: 'keine',
  unread: 'Die Zahl kommt vom Server, mit Verbindung.',
} as const

/**
 * "Bei diesem Betreiber": the duties confirmed from this kind that have not
 * ended, in the areas of the person, counted by the register of duties
 * itself, so that the number and the list it leads to cannot differ.
 */
function AtThisOperator({ dutyKind }: { readonly dutyKind: string }) {
  const confirmed = useQuery({
    queryKey: ['duties', 'register', 'count', dutyKind],
    queryFn: () => request<DutyRegister>(dutyRegisterRequest({ dutyKind }, 0, 1)),
  })
  const total = confirmed.data?.total

  return (
    <Panel title="Bei diesem Betreiber">
      {total === undefined || total === null ? (
        <Words small>{atThisOperatorWords.unread}</Words>
      ) : (
        <FactList
          keyWidth={100}
          facts={[
            {
              label: 'Bestätigt',
              value:
                total === 0 ? (
                  atThisOperatorWords.none
                ) : (
                  <Link
                    to={dutyRegisterPlace.to}
                    search={dutySearch({ dutyKind })}
                    className={factLink}
                  >
                    {total === 1 ? '1 Pflicht' : `${total.toLocaleString('de-DE')} Pflichten`}
                  </Link>
                ),
            },
          ]}
        />
      )}
    </Panel>
  )
}

/** A paragraph of a card: 15 pixels on a phone, as the facts beside it. */
function Words({
  small = false,
  children,
}: {
  readonly small?: boolean
  readonly children: ReactNode
}) {
  return (
    <p
      className={`m-0 leading-[1.45] max-sm:text-[15px] ${
        small ? 'text-[12px] text-ink-muted' : 'text-[13px] text-ink'
      }`}
    >
      {children}
    </p>
  )
}

const findingTones = {
  waiting: 'text-waiting',
  done: 'text-done',
  plain: 'text-ink',
} as const

/** One finding of the review in a line, with its symbol: told by more than its colour. */
function Finding({
  tone,
  icon,
  children,
}: {
  readonly tone: keyof typeof findingTones
  readonly icon: ReactNode
  readonly children: ReactNode
}) {
  return (
    <p
      className={`m-0 flex items-start gap-2 text-[14px] font-semibold leading-[1.3] max-sm:text-[15px] ${findingTones[tone]}`}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** How long the evidence is kept, with the number of years where the rule has one today. */
function retentionWords(catalogue: Catalogue, kind: DutyKind, on: string): string {
  if (kind.retention.kind !== 'years') {
    return retentionKindLabel[kind.retention.kind]
  }

  const kept = catalogue.retention(kind, on)

  return kept?.kind === 'years'
    ? ruleValueWords(kept.rule.record.value, kept.rule.record.unit)
    : `${retentionKindLabel.years}, heute ohne Wert`
}

/** A rule a duty kind names, with what it is to the kind. */
interface NamedRule {
  readonly role: string
  readonly key: string
}

/**
 * The rules a duty kind runs by: its interval, the years its evidence is
 * kept, and the thresholds of its scope. Each key once, in that order.
 */
function rulesOf(kind: DutyKind): readonly NamedRule[] {
  const named: NamedRule[] = []

  if (kind.interval.kind !== 'none') {
    named.push({ role: intervalKindLabel[kind.interval.kind], key: kind.interval.rule })
  }

  if (kind.retention.kind === 'years') {
    named.push({ role: 'Aufbewahrung', key: kind.retention.rule })
  }

  for (const condition of kind.scope.conditions) {
    if ('atLeast' in condition) {
      named.push({ role: 'Schwelle im Geltungsbereich', key: condition.atLeast })
    } else if ('below' in condition) {
      named.push({ role: 'Schwelle im Geltungsbereich', key: condition.below })
    }
  }

  return named.filter((rule, index) => named.findIndex((other) => other.key === rule.key) === index)
}

function Rules({ catalogue, kind }: { readonly catalogue: Catalogue; readonly kind: DutyKind }) {
  const rows = rulesOf(kind).flatMap(({ role, key }) =>
    catalogue.ruleRecords(key).map((rule: CatalogueRule) => ({ role, rule })),
  )

  if (rows.length === 0) {
    return (
      <Panel title="Regeln">
        <Words>
          Diese Pflichtart läuft nach keiner Regel des Katalogs: die Frist trägt der Betreiber ein.
        </Words>
      </Panel>
    )
  }

  const until = (rule: CatalogueRule) =>
    rule.record.validUntil === null ? 'offen' : date(rule.record.validUntil)

  return (
    <TablePanel
      title="Regeln"
      caption="Regeln dieser Pflichtart"
      note="Ändert sich die Vorschrift, endet ein Datensatz und ein neuer beginnt. Für eine Prüfung gilt die Frist ihres Tages."
      cards={rows.map(({ role, rule }) => ({
        key: `${rule.record.key} ${scopeOf(rule.record)} ${rule.record.validFrom}`,
        title: `${role}: ${ruleValueWords(rule.record.value, rule.record.unit)}`,
        sub: (
          <>
            <span className="block">
              {ruleScopeNames[scopeOf(rule.record)]} · {appliesWords(rule.record)}
            </span>
            <span className="block">{reviewLine(rule.review)}</span>
          </>
        ),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[110px]">Regel</Column>
          <Column className="w-[92px] min-w-[76px]">Wert</Column>
          <Column className="w-[84px] min-w-[68px]">Gilt ab</Column>
          <Column className="w-[84px] min-w-[68px]">Gilt bis</Column>
          <Column className="w-[152px] min-w-[140px]">Abnahme</Column>
          <Column className="w-[92px] min-w-[72px]">Zuletzt geprüft</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ role, rule }) => (
          <tr key={`${rule.record.key} ${scopeOf(rule.record)} ${rule.record.validFrom}`}>
            <Cell>
              {role}
              <span className="block text-[12px] text-ink-muted">
                {ruleScopeNames[scopeOf(rule.record)]}
              </span>
            </Cell>
            <Cell>{ruleValueWords(rule.record.value, rule.record.unit)}</Cell>
            <Cell>
              <span className="numeric">{date(rule.record.validFrom)}</span>
            </Cell>
            <Cell>
              {rule.record.validUntil === null ? (
                <span className="text-ink-muted">offen</span>
              ) : (
                <span className="numeric">{until(rule)}</span>
              )}
            </Cell>
            <Cell>
              <Acceptance review={rule.review} />
            </Cell>
            <Cell>
              <CheckedOn review={rule.review} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
