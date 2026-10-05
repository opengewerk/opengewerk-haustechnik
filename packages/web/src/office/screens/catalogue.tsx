import {
  acceptanceTally,
  type Catalogue,
  catalogueOriginLabel,
  type CatalogueReview,
  type CatalogueRule,
  dutyTaskLabel,
  generalPackage,
  intervalLine,
  type PackageContents,
  type PackagedForm,
  ruleScopeNames,
  ruleValueWords,
  scopeOf,
} from '@opengewerk/haustechnik-domain'
import { cardLink, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { Link, useParams } from '@tanstack/react-router'
import { type ReactNode, useMemo } from 'react'

import { Acceptance, CheckedOn, reviewLine, ReviewMark } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import {
  type CataloguePart,
  catalogueParts,
  cataloguePlaces,
  isCataloguePart,
} from '../catalogue-addresses.js'

/**
 * "Katalog" in the office, `katalog()` of the boards (section 5 of the
 * concept): the packages this instance works with, and of the one chosen its
 * duty kinds, asset kinds, forms, rules, round templates and defect classes.
 *
 * Read from the catalogue the device holds (`sync/catalogue.ts`), so it stands
 * without a network, and it is the catalogue the server computes with. No
 * entry is shown without its review: every row says whether somebody with
 * expertise has accepted it and when it was last checked against its source.
 *
 * The package and its part are in the address, so that the way back leads to
 * the list somebody came from and a link to a part can be handed on.
 */
export function CatalogueScreen() {
  const { packageName, part } = useParams({ strict: false }) as {
    packageName?: string
    part?: string
  }
  const catalogue = useCatalogue()
  const on = today()
  const packages = useMemo(() => catalogue?.contents(on) ?? [], [catalogue, on])

  if (catalogue === null) {
    return (
      <Framed>
        <Panel>
          <Empty>
            Der Katalog ist noch nicht auf diesem Gerät. Er kommt mit der nächsten Verbindung zum
            Server.
          </Empty>
        </Panel>
      </Framed>
    )
  }

  if (packages.length === 0) {
    return (
      <Framed>
        <Panel>
          <Empty>
            Diese Instanz bringt noch kein Paket mit. Pakete kommen mit einer Fassung der Anwendung.
          </Empty>
        </Panel>
      </Framed>
    )
  }

  const chosen =
    packageName === undefined ? packages[0] : packages.find((entry) => entry.name === packageName)

  if (chosen === undefined || (part !== undefined && !isCataloguePart(part))) {
    return <NotInCatalogue />
  }

  return (
    <Framed>
      <Packages packages={packages} chosen={chosen.name} />
      <Chosen catalogue={catalogue} contents={chosen} part={part ?? 'pflichtarten'} on={on} />
      <NoteBox>
        Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Er sagt, was er abdeckt; die
        Verantwortung des Betreibers bleibt beim Betreiber. Ein Eintrag ohne fachkundige Abnahme
        oder seit über einem Jahr ungeprüft ist gekennzeichnet.
      </NoteBox>
    </Framed>
  )
}

function Framed({ children }: { readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead
        title="Katalog"
        sub="Die Pakete dieser Instanz mit ihren Anlagenarten, Pflichtarten, Formularen und Regeln"
      />
      {children}
    </Screen>
  )
}

/** An address under the catalogue that names nothing in it. */
export function NotInCatalogue() {
  return (
    <Screen>
      <PageHead title="Nicht im Katalog" crumbs={[cataloguePlaces.list]} />
      <Empty>
        Diesen Eintrag gibt es im Katalog dieser Instanz nicht, oder dieses Gerät hält den Katalog
        noch nicht.
      </Empty>
    </Screen>
  )
}

/** "1 Pflichtart", "14 Pflichtarten". */
function counted(amount: number, one: string, more: string): string {
  return `${amount.toLocaleString('de-DE')} ${amount === 1 ? one : more}`
}

/**
 * How many entries of a package are accepted, of how many: every entry
 * counts, a rule and an asset kind like a duty kind (`acceptanceTally`).
 */
function Tally({ contents }: { readonly contents: PackageContents }) {
  const { accepted, entries } = acceptanceTally(contents)

  if (entries === 0) {
    return <span className="text-ink-muted">nichts abzunehmen</span>
  }

  const words = (
    <>
      {accepted.toLocaleString('de-DE')} von {entries.toLocaleString('de-DE')}
      <span className="sr-only"> abgenommen</span>
    </>
  )

  return accepted === entries ? (
    <Status tone="done">{words}</Status>
  ) : (
    <ReviewMark>{words}</ReviewMark>
  )
}

function Packages({
  packages,
  chosen,
}: {
  readonly packages: readonly PackageContents[]
  readonly chosen: string
}) {
  return (
    <TablePanel
      title="Pakete"
      caption="Pakete des Katalogs"
      cards={packages.map((entry) => ({
        key: entry.name,
        title: (
          <Link to={cataloguePlaces.package(entry.name)} className={cardLink}>
            {entry.title}
          </Link>
        ),
        sub: [
          `Fassung ${entry.version}`,
          counted(entry.assetKinds.length, 'Anlagenart', 'Anlagenarten'),
          counted(entry.dutyKinds.length, 'Pflichtart', 'Pflichtarten'),
          counted(entry.forms.length, 'Formular', 'Formulare'),
        ].join(' · '),
        right: <Tally contents={entry} />,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[180px]">Paket</Column>
          <Column className="w-[100px] min-w-[80px]">Fassung</Column>
          <Column numeric className="w-[120px] min-w-[110px]">
            Anlagenarten
          </Column>
          <Column numeric className="w-[120px] min-w-[110px]">
            Pflichtarten
          </Column>
          <Column numeric className="w-[110px] min-w-[96px]">
            Formulare
          </Column>
          <Column className="w-[170px] min-w-[150px]">Abgenommen</Column>
        </tr>
      </thead>
      <tbody>
        {packages.map((entry) => (
          <tr key={entry.name} className={entry.name === chosen ? 'bg-selected' : undefined}>
            <Cell>
              <Link
                to={cataloguePlaces.package(entry.name)}
                aria-current={entry.name === chosen ? 'true' : undefined}
              >
                {entry.title}
              </Link>
            </Cell>
            <Cell>
              <span className="numeric">{entry.version}</span>
            </Cell>
            <Cell numeric>{entry.assetKinds.length.toLocaleString('de-DE')}</Cell>
            <Cell numeric>{entry.dutyKinds.length.toLocaleString('de-DE')}</Cell>
            <Cell numeric>{entry.forms.length.toLocaleString('de-DE')}</Cell>
            <Cell>
              <Tally contents={entry} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** How many entries each part of a package has, for its link. */
function sizeOf(contents: PackageContents, part: CataloguePart): number {
  switch (part) {
    case 'pflichtarten':
      return contents.dutyKinds.length
    case 'anlagenarten':
      return contents.assetKinds.length
    case 'formulare':
      return contents.forms.length
    case 'regeln':
      return contents.rules.length
    case 'vorlagen':
      return contents.roundTemplates.length
    case 'mangelklassen':
      return contents.defectClasses.length
  }
}

/** The package chosen: what it is, and one of its parts. */
function Chosen({
  catalogue,
  contents,
  part,
  on,
}: {
  readonly catalogue: Catalogue
  readonly contents: PackageContents
  readonly part: CataloguePart
  readonly on: string
}) {
  return (
    <Panel>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-[16px] font-semibold text-ink">
            {contents.title}, Fassung {contents.version}
          </h2>
          <span className="text-[13px] text-ink-muted">
            benötigt Kernfassung {contents.minimumCore}
          </span>
        </div>
        {/* Links and no tabs: each part has an address of its own. */}
        <nav
          aria-label="Teile des Pakets"
          className="flex flex-wrap gap-x-[22px] border-b border-line"
        >
          {catalogueParts.map((entry) => (
            <Link
              key={entry.address}
              to={cataloguePlaces.part(contents.name, entry.address)}
              aria-current={entry.address === part ? 'page' : undefined}
              className={`-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-0.5 text-[14px] no-underline ${
                entry.address === part
                  ? 'border-copper font-semibold text-ink'
                  : 'border-transparent text-ink-muted'
              }`}
            >
              {entry.label}
              <span className="numeric">
                {sizeOf(contents, entry.address).toLocaleString('de-DE')}
              </span>
            </Link>
          ))}
        </nav>
        <Part catalogue={catalogue} contents={contents} part={part} on={on} />
      </div>
    </Panel>
  )
}

/** A row of a part: what stands in its columns before the two of the review. */
interface Listed {
  readonly key: string
  /** The name of the entry, in the first column and as the title of its box on a phone. */
  readonly name: ReactNode
  /** The page of the entry, where it has one: the name leads there, on a phone the whole box. */
  readonly to?: string
  /** Under the name, smaller: the task of a duty kind, where a rule applies. */
  readonly under?: string
  readonly cells: readonly ReactNode[]
  /** The cells in a line, for the box on a phone. */
  readonly line: string
  readonly review: CatalogueReview
}

interface Heading {
  readonly label: string
  readonly className?: string
  readonly numeric?: boolean
}

/**
 * The entries of a part in a table. The two columns at the end are the same
 * for every part and cannot be left out: no entry without its review.
 */
function Entries({
  caption,
  headings,
  rows,
}: {
  readonly caption: string
  readonly headings: readonly Heading[]
  readonly rows: readonly Listed[]
}) {
  return (
    <TablePanel
      caption={caption}
      cards={rows.map((row) => ({
        key: row.key,
        title:
          row.to === undefined ? (
            row.name
          ) : (
            <Link to={row.to} className={cardLink}>
              {row.name}
            </Link>
          ),
        sub: (
          <>
            {row.under === undefined ? null : <span className="block">{row.under}</span>}
            <span className="block">{row.line}</span>
            <span className="block">{reviewLine(row.review)}</span>
          </>
        ),
      }))}
    >
      <thead>
        <tr>
          {headings.map((heading) => (
            <Column key={heading.label} numeric={heading.numeric} className={heading.className}>
              {heading.label}
            </Column>
          ))}
          <Column className="w-[160px] min-w-[140px]">Abnahme</Column>
          <Column className="w-[110px] min-w-[72px]">Zuletzt geprüft</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <Cell>
              {row.to === undefined ? row.name : <Link to={row.to}>{row.name}</Link>}
              {row.under === undefined ? null : (
                <span className="block text-[12px] text-ink-muted">{row.under}</span>
              )}
            </Cell>
            {row.cells.map((cell, index) => (
              <Cell key={headings[index + 1]?.label} numeric={headings[index + 1]?.numeric}>
                {cell}
              </Cell>
            ))}
            <Cell>
              <Acceptance review={row.review} />
            </Cell>
            <Cell>
              <CheckedOn review={row.review} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function Nothing({ children }: { readonly children: ReactNode }) {
  return (
    <p className="m-0 text-[13px] leading-[1.4] text-ink-muted max-sm:text-[15px]">{children}</p>
  )
}

/** The time a record of a rule applies in, in a line: one that has not ended names no end. */
export function appliesWords(
  record: Pick<CatalogueRule['record'], 'validFrom' | 'validUntil'>,
): string {
  const from = `gilt ab ${date(record.validFrom)}`

  return record.validUntil === null ? from : `${from} bis ${date(record.validUntil)}`
}

/** The key of a rule. Where it has to wrap, it does so after a dot or an underscore. */
function RuleKey({ children }: { readonly children: string }) {
  const parts = children.match(/[^._]+[._]*|[._]+/g) ?? [children]

  return (
    <code className="text-[12px] [overflow-wrap:anywhere]">
      {parts.flatMap((part, index) => (index === 0 ? [part] : [<wbr key={index} />, part]))}
    </code>
  )
}

/** A form or a round template: how much there is to fill in. */
function formRows(entries: PackageContents['forms']): readonly Listed[] {
  const fieldsOf = (form: PackagedForm) =>
    form.sections.reduce((sum, section) => sum + section.fields.length, 0)

  return entries.map((entry) => {
    const sections = counted(entry.definition.sections.length, 'Abschnitt', 'Abschnitte')
    const fields = counted(fieldsOf(entry.definition), 'Punkt', 'Punkte')

    return {
      key: entry.key,
      name: entry.definition.title,
      cells: [
        entry.definition.sections.length.toLocaleString('de-DE'),
        fieldsOf(entry.definition).toLocaleString('de-DE'),
      ],
      line: `${sections} · ${fields}`,
      review: entry.review,
    }
  })
}

/**
 * Asset kinds in the order assets are sorted by everywhere: by cost group
 * (guiding decision 11 of the concept), then by what they are called. The
 * bundle holds them by key, which no reader sees.
 */
function byCostGroup(
  left: PackageContents['assetKinds'][number],
  right: PackageContents['assetKinds'][number],
): number {
  return (
    left.definition.costGroup.localeCompare(right.definition.costGroup) ||
    left.definition.label.localeCompare(right.definition.label, 'de')
  )
}

/** Where a defect class comes from that names no source: the package has drawn it up itself. */
const ownClassification = 'eigene Einteilung des Pakets'

const formHeadings = (first: string): readonly Heading[] => [
  { label: first, className: 'min-w-[200px]' },
  { label: 'Abschnitte', numeric: true, className: 'w-[110px] min-w-[96px]' },
  { label: 'Punkte', numeric: true, className: 'w-[90px] min-w-[76px]' },
]

function Part({
  catalogue,
  contents,
  part,
  on,
}: {
  readonly catalogue: Catalogue
  readonly contents: PackageContents
  readonly part: CataloguePart
  readonly on: string
}) {
  switch (part) {
    case 'pflichtarten':
      return contents.dutyKinds.length === 0 ? (
        <Nothing>
          {contents.name === generalPackage
            ? 'Dieses Paket hat keine Pflichtarten: seine Anlagenarten stehen für Anlagen, deren Fachpaket noch fehlt, und der Katalog schlägt für sie keine Pflichten vor.'
            : 'Dieses Paket hat keine Pflichtarten.'}
        </Nothing>
      ) : (
        <Entries
          caption={`Pflichtarten im Paket ${contents.title}`}
          headings={[
            { label: 'Pflichtart', className: 'min-w-[180px]' },
            { label: 'Fundstelle', className: 'min-w-[150px]' },
            { label: 'Herkunft', className: 'min-w-[150px]' },
            { label: 'Frist', className: 'min-w-[150px]' },
          ]}
          rows={contents.dutyKinds.map((entry) => {
            const interval = intervalLine(catalogue, entry.definition, on)

            return {
              key: entry.key,
              name: entry.definition.label,
              to: cataloguePlaces.dutyKind(entry.key),
              under: dutyTaskLabel[entry.definition.task],
              cells: [
                entry.definition.source,
                catalogueOriginLabel[entry.definition.origin],
                interval,
              ],
              line: `${entry.definition.source} · ${interval}`,
              review: entry.review,
            }
          })}
        />
      )
    case 'anlagenarten':
      return contents.assetKinds.length === 0 ? (
        <Nothing>Dieses Paket hat keine Anlagenarten.</Nothing>
      ) : (
        <Entries
          caption={`Anlagenarten im Paket ${contents.title}`}
          headings={[
            { label: 'Anlagenart', className: 'min-w-[180px]' },
            { label: 'Kostengruppe', className: 'w-[130px] min-w-[120px]' },
            { label: 'Merkmale', numeric: true, className: 'w-[100px] min-w-[90px]' },
            { label: 'Angaben', numeric: true, className: 'w-[100px] min-w-[84px]' },
          ]}
          rows={[...contents.assetKinds].sort(byCostGroup).map((entry) => ({
            key: entry.key,
            name: entry.definition.label,
            ...(entry.definition.meter === null ? {} : { under: 'Messstelle' }),
            cells: [
              <span key="group" className="numeric">
                {entry.definition.costGroup}
              </span>,
              entry.definition.characteristics.length.toLocaleString('de-DE'),
              entry.definition.fields.length.toLocaleString('de-DE'),
            ],
            line: [
              `Kostengruppe ${entry.definition.costGroup}`,
              counted(entry.definition.characteristics.length, 'Merkmal', 'Merkmale'),
              counted(entry.definition.fields.length, 'Angabe', 'Angaben'),
            ].join(' · '),
            review: entry.review,
          }))}
        />
      )
    case 'formulare':
      return contents.forms.length === 0 ? (
        <Nothing>Dieses Paket hat keine Formulare.</Nothing>
      ) : (
        <Entries
          caption={`Formulare im Paket ${contents.title}`}
          headings={formHeadings('Formular')}
          rows={formRows(contents.forms)}
        />
      )
    case 'vorlagen':
      return contents.roundTemplates.length === 0 ? (
        <Nothing>Dieses Paket hat keine Vorlagen für Rundgänge.</Nothing>
      ) : (
        <Entries
          caption={`Vorlagen für Rundgänge im Paket ${contents.title}`}
          headings={formHeadings('Vorlage')}
          rows={formRows(contents.roundTemplates)}
        />
      )
    case 'regeln':
      return contents.rules.length === 0 ? (
        <Nothing>Dieses Paket hat keine Regeln.</Nothing>
      ) : (
        <Entries
          caption={`Regeln im Paket ${contents.title}`}
          headings={[
            { label: 'Regel', className: 'min-w-[240px]' },
            { label: 'Wert', className: 'w-[100px] min-w-[76px]' },
            { label: 'Fundstelle', className: 'min-w-[150px]' },
            { label: 'Gilt ab', className: 'w-[84px] min-w-[68px]' },
            { label: 'Gilt bis', className: 'w-[84px] min-w-[68px]' },
          ]}
          rows={contents.rules.map(({ record, review }) => {
            const value = ruleValueWords(record.value, record.unit)
            const until = record.validUntil === null ? 'offen' : date(record.validUntil)

            return {
              key: `${record.key} ${scopeOf(record)} ${record.validFrom}`,
              name: <RuleKey>{record.key}</RuleKey>,
              under: ruleScopeNames[scopeOf(record)],
              cells: [
                value,
                record.source,
                <span key="from" className="numeric">
                  {date(record.validFrom)}
                </span>,
                record.validUntil === null ? (
                  <span key="until" className="text-ink-muted">
                    offen
                  </span>
                ) : (
                  <span key="until" className="numeric">
                    {until}
                  </span>
                ),
              ],
              line: `${value} · ${appliesWords(record)}`,
              review,
            }
          })}
        />
      )
    case 'mangelklassen':
      return contents.defectClasses.length === 0 ? (
        <Nothing>Dieses Paket hat keine eigenen Mängelklassen.</Nothing>
      ) : (
        <Entries
          caption={`Mängelklassen im Paket ${contents.title}`}
          headings={[
            { label: 'Mängelklasse', className: 'min-w-[160px]' },
            { label: 'Macht die Anlage unsicher', className: 'w-[210px] min-w-[190px]' },
            { label: 'Fundstelle', className: 'min-w-[150px]' },
          ]}
          rows={contents.defectClasses.map(({ defectClass, review }) => {
            const unsafe = defectClass.unsafe ? 'ja' : 'nein'
            const source = defectClass.source ?? ownClassification

            return {
              key: defectClass.key,
              name: defectClass.label,
              cells: [
                unsafe,
                defectClass.source === null ? (
                  <span key="source" className="text-ink-muted">
                    {source}
                  </span>
                ) : (
                  source
                ),
              ],
              line: `${
                defectClass.unsafe ? 'macht die Anlage unsicher' : 'macht die Anlage nicht unsicher'
              } · ${source}`,
              review,
            }
          })}
        />
      )
  }
}
