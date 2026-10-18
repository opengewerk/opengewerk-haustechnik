import {
  costGroupWords,
  documentKindLabel,
  type ExpectedDocument,
  expectedDemandLabel,
  isOwnKind,
  ownFieldSortLabel,
  ownPackage,
  type Right,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  cardLink,
  Column,
  Confirm,
  Panel,
  Status,
  TablePanel,
} from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { catalogueAbsenceWords, useCatalogue, useCatalogueAbsence } from '../../sync/catalogue.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import {
  type OwnFieldView,
  ownKindKeyOf,
  ownKindPlaces,
  ownKindRoutes,
  ownKindsQuery,
  ownPackageWords,
  ownView,
  type OwnView,
} from '../own-kind-addresses.js'
import {
  OwnDocumentDialog,
  OwnFieldDialog,
  OwnKindDialog,
  ownKindWords,
  Trouble,
  useOwnKindRoute,
} from '../own-kind-dialogs.js'
import { Framed, NotInCatalogue, Packages } from './catalogue.js'

/**
 * The asset kinds and fields of the operator's own in the office (#62, the
 * boards "Katalog mit den eigenen Anlagenarten des Betreibers", "Eigene
 * Angaben an Anlagenarten aus Paketen" and "Eigene Anlagenart mit Angaben und
 * Unterlagen"): beside the packages under "Katalog", each kind with its page.
 *
 * Everybody reads them in the catalogue the device holds, which the server
 * hands out with them. Whoever may keep them, the Leitung and the Technische
 * Leitung, reads them from the server, with what uses each, and changes them
 * there; the device fetches the catalogue again afterwards.
 */

export const ownKindScreenWords = {
  heading: 'Eigene dieses Betreibers',
  kindsLead:
    'Eine eigene Anlagenart gilt nur bei diesem Betreiber, für Anlagen, die kein Paket beschreibt. Pflichten schlägt der Katalog für sie nicht vor; an jeder Anlage lässt sich eine eigene Pflicht anlegen.',
  fieldsLead:
    'Eine eigene Angabe ergänzt eine Anlagenart aus einem Paket, ohne das Paket zu ändern. Sie steht an jeder Anlage dieser Art neben den Angaben des Pakets.',
  noKinds: 'Dieser Betreiber hat keine eigene Anlagenart.',
  noFields: 'Dieser Betreiber hat keiner Anlagenart aus einem Paket eine eigene Angabe gegeben.',
  ownKind: 'Eigene Anlagenart',
  sub: 'Eigene Anlagenart dieses Betreibers',
  fieldsNote:
    'Eine Angabe, die eine Anlage als Wert trägt, wird nicht entfernt, und ihre Sorte bleibt. Bezeichnung, Einheit und weitere Auswahlen lassen sich ändern.',
  documentsNote:
    'Wie bei einer Anlagenart aus einem Paket: die Akte jeder Anlage dieser Art zeigt, was davon an ihr liegt und was fehlt.',
  noFieldsAtKind: 'Diese Anlagenart hat noch keine Angabe.',
  noDocuments: 'Diese Anlagenart erwartet keine Unterlage.',
  duties:
    'Pflichten schlägt der Katalog für eine eigene Anlagenart nicht vor. An jeder Anlage dieser Art lässt sich eine eigene Pflicht mit Grundlage, Quelle, Tätigkeit und Frist anlegen.',
  removeKind: 'Entfernen geht, solange keine Anlage diese Art trägt.',
} as const

/** "1 Anlage", "4 Anlagen". */
function assetsWords(count: number): string {
  return count === 1 ? '1 Anlage' : `${count.toLocaleString('de-DE')} Anlagen`
}

/** What a field takes beside its label: the unit of a number, the choices of a choice. */
function unitOrChoices(field: OwnFieldView): string {
  return field.sort === 'number'
    ? (field.unit ?? '')
    : field.sort === 'choice'
      ? field.options.map((option) => option.label).join(', ')
      : ''
}

/** The own kinds and fields, from the server for whoever keeps them, else from the catalogue on the device. */
function useOwn(): { readonly keeps: boolean; readonly view: OwnView } {
  const keeps = useRight('kind.write' satisfies Right)
  const catalogue = useCatalogue()
  const reading = useQuery({ ...ownKindsQuery, enabled: keeps })

  return {
    keeps,
    view: useMemo(
      () => ownView(keeps ? reading.data : undefined, catalogue),
      [keeps, reading.data, catalogue],
    ),
  }
}

/** The tabs of the own part, each an address of its own, as the parts of a package. */
function OwnParts({
  part,
  kinds,
  fields,
}: {
  readonly part: 0 | 1
  readonly kinds: number
  readonly fields: number
}) {
  const parts = [
    { to: ownKindPlaces.list, label: 'Anlagenarten', count: kinds },
    { to: ownKindPlaces.fields, label: 'Angaben an Anlagenarten aus Paketen', count: fields },
  ]

  return (
    <nav
      aria-label="Teile des Eigenen"
      className="flex flex-wrap gap-x-[22px] border-b border-line"
    >
      {parts.map((entry, index) => (
        <Link
          key={entry.to}
          to={entry.to}
          aria-current={index === part ? 'page' : undefined}
          className={`-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-0.5 text-[14px] no-underline ${
            index === part
              ? 'border-copper font-semibold text-ink'
              : 'border-transparent text-ink-muted'
          }`}
        >
          {entry.label}
          <span className="numeric">{entry.count.toLocaleString('de-DE')}</span>
        </Link>
      ))}
    </nav>
  )
}

/**
 * "Katalog", what the operator added: its kinds, or its fields at kinds of
 * the packages, with the packages above as on every page of the catalogue.
 */
function OwnCatalogueScreen({ part }: { readonly part: 0 | 1 }) {
  const catalogue = useCatalogue()
  const absence = useCatalogueAbsence()
  const navigate = useNavigate()
  const { keeps, view } = useOwn()
  const [making, setMaking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<OwnFieldView | null>(null)
  const [removing, setRemoving] = useState<OwnFieldView | null>(null)
  const on = today()
  const packages = useMemo(() => catalogue?.contents(on) ?? [], [catalogue, on])
  const kinds = useMemo(() => catalogue?.assetKinds(on) ?? [], [catalogue, on])
  const removal = useOwnKindRoute(() => {
    setRemoving(null)
  })

  if (catalogue === null) {
    return (
      <Framed>
        <Panel>
          <Empty>{absence ?? catalogueAbsenceWords.notYet}</Empty>
        </Panel>
      </Framed>
    )
  }

  const kindLabel = (key: string) => catalogue.assetKind(key, on)?.definition.label ?? key
  const packageTitle = (key: string) =>
    catalogue.packages.find((entry) => entry.name === key.slice(0, key.indexOf('.')))?.title ?? ''
  const counted = view.kinds.some((kind) => kind.assets !== null)

  return (
    <Framed>
      <Packages packages={packages} chosen={ownPackage} own={view.kinds.length} />
      <Panel>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="m-0 text-[16px] font-semibold text-ink">{ownKindScreenWords.heading}</h2>
            <span className="grow" />
            {keeps ? (
              part === 0 ? (
                <Button
                  tone="primary"
                  icon={Plus}
                  onClick={() => {
                    setMaking(true)
                  }}
                >
                  {ownKindWords.makeKind}
                </Button>
              ) : (
                <Button
                  tone="primary"
                  icon={Plus}
                  onClick={() => {
                    setAdding(true)
                  }}
                >
                  {ownKindWords.addField}
                </Button>
              )
            ) : null}
          </div>
          <p className="text-[13px] text-ink-muted">
            {part === 0 ? ownKindScreenWords.kindsLead : ownKindScreenWords.fieldsLead}
          </p>
          <OwnParts part={part} kinds={view.kinds.length} fields={view.fields.length} />
          {part === 0 ? (
            view.kinds.length === 0 ? (
              <Empty>{ownKindScreenWords.noKinds}</Empty>
            ) : (
              <TablePanel
                caption="Eigene Anlagenarten mit Kostengruppe, Angaben und Unterlagen"
                grow={false}
                cards={view.kinds.map((kind) => ({
                  key: kind.key,
                  title: (
                    <Link to={ownKindPlaces.kind(kind.key)} className={cardLink}>
                      {kind.label}
                    </Link>
                  ),
                  sub: [
                    costGroupWords(kind.costGroup, kinds),
                    `${String(kind.fields.length)} Angaben`,
                    `${String(kind.documents.length)} Unterlagen`,
                    ...(kind.assets === null ? [] : [assetsWords(kind.assets)]),
                  ].join(' · '),
                }))}
              >
                <thead>
                  <tr>
                    <Column className="min-w-[200px]">Anlagenart</Column>
                    <Column className="w-[220px] min-w-[180px]">Kostengruppe</Column>
                    <Column numeric className="w-[100px] min-w-[90px]">
                      Angaben
                    </Column>
                    <Column numeric className="w-[110px] min-w-[100px]">
                      Unterlagen
                    </Column>
                    {counted ? (
                      <Column numeric className="w-[100px] min-w-[90px]">
                        Anlagen
                      </Column>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {view.kinds.map((kind) => (
                    <tr key={kind.key}>
                      <Cell>
                        <Link to={ownKindPlaces.kind(kind.key)}>{kind.label}</Link>
                        <span className="block text-[12px] text-ink-faint">
                          {ownKindScreenWords.ownKind}
                        </span>
                      </Cell>
                      <Cell>{costGroupWords(kind.costGroup, kinds)}</Cell>
                      <Cell numeric>{kind.fields.length.toLocaleString('de-DE')}</Cell>
                      <Cell numeric>{kind.documents.length.toLocaleString('de-DE')}</Cell>
                      {counted ? (
                        <Cell numeric>{(kind.assets ?? 0).toLocaleString('de-DE')}</Cell>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </TablePanel>
            )
          ) : view.fields.length === 0 ? (
            <Empty>{ownKindScreenWords.noFields}</Empty>
          ) : (
            <TablePanel
              caption="Eigene Angaben an Anlagenarten aus Paketen mit Sorte"
              grow={false}
              cards={view.fields.map((field) => ({
                key: field.key,
                title: field.label,
                sub: [
                  kindLabel(field.assetKind),
                  ownFieldSortLabel[field.sort],
                  ...(field.values === null ? [] : [`${String(field.values)} mit Wert`]),
                ].join(' · '),
              }))}
            >
              <thead>
                <tr>
                  <Column className="w-[220px] min-w-[180px]">Anlagenart</Column>
                  <Column className="min-w-[180px]">Angabe</Column>
                  <Column className="w-[130px] min-w-[110px]">Sorte</Column>
                  {keeps ? (
                    <>
                      <Column numeric className="w-[100px] min-w-[90px]">
                        Mit Wert
                      </Column>
                      <Column className="w-[200px] min-w-[180px]">
                        <span className="sr-only">Ändern</span>
                      </Column>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {view.fields.map((field) => (
                  <tr key={field.key}>
                    <Cell>
                      {kindLabel(field.assetKind)}
                      <span className="block text-[12px] text-ink-faint">
                        {packageTitle(field.assetKind)}
                      </span>
                    </Cell>
                    <Cell>{field.label}</Cell>
                    <Cell>{ownFieldSortLabel[field.sort]}</Cell>
                    {keeps ? (
                      <>
                        <Cell numeric>{(field.values ?? 0).toLocaleString('de-DE')}</Cell>
                        <Cell>
                          <FieldActions field={field} onEdit={setEditing} onRemove={setRemoving} />
                        </Cell>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )}
        </div>
      </Panel>
      <NoteBox>
        Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Er sagt, was er abdeckt; die
        Verantwortung des Betreibers bleibt beim Betreiber. Ein Eintrag ohne fachkundige Abnahme
        oder seit über einem Jahr ungeprüft ist gekennzeichnet.
      </NoteBox>
      {making ? (
        <OwnKindDialog
          onClose={() => {
            setMaking(false)
          }}
          onMade={(key) => {
            void navigate({ to: ownKindPlaces.kind(key) })
          }}
        />
      ) : null}
      {adding ? (
        <OwnFieldDialog
          onClose={() => {
            setAdding(false)
          }}
        />
      ) : null}
      {editing === null ? null : (
        <OwnFieldDialog
          key={editing.key}
          field={editing}
          onClose={() => {
            setEditing(null)
          }}
        />
      )}
      <FieldRemoval
        field={removing}
        working={removal.working}
        trouble={removal.trouble}
        onConfirm={(field) => {
          if (field.id !== null) {
            void removal.run('DELETE', ownKindRoutes.field(field.id))
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      />
    </Framed>
  )
}

/** "Katalog", the kinds of the operator's own. */
export function OwnKindsListScreen() {
  return <OwnCatalogueScreen part={0} />
}

/** "Katalog", the fields of the operator's own at kinds of the packages. */
export function OwnFieldsListScreen() {
  return <OwnCatalogueScreen part={1} />
}

/** "Bearbeiten", and "Entfernen" while no asset holds a value of the field. */
function FieldActions({
  field,
  onEdit,
  onRemove,
}: {
  readonly field: OwnFieldView
  readonly onEdit: (field: OwnFieldView) => void
  readonly onRemove: (field: OwnFieldView) => void
}) {
  return (
    <div className="flex justify-end gap-1.5">
      <Button
        size="small"
        onClick={() => {
          onEdit(field)
        }}
      >
        Bearbeiten
      </Button>
      {field.values === 0 ? (
        <Button
          size="small"
          onClick={() => {
            onRemove(field)
          }}
        >
          Entfernen
        </Button>
      ) : null}
    </div>
  )
}

function FieldRemoval({
  field,
  working,
  trouble,
  onConfirm,
  onCancel,
}: {
  readonly field: OwnFieldView | null
  readonly working: boolean
  readonly trouble: string | null
  readonly onConfirm: (field: OwnFieldView) => void
  readonly onCancel: () => void
}) {
  return (
    <Confirm
      open={field !== null}
      title={`${field?.label ?? 'Angabe'} entfernen?`}
      confirm={working ? 'Einen Moment' : 'Entfernen'}
      tone="danger"
      onConfirm={() => {
        if (field !== null) {
          onConfirm(field)
        }
      }}
      onCancel={onCancel}
    >
      <p>Keine Anlage hat einen Wert dieser Angabe. Ihr Schlüssel bleibt vergeben.</p>
      <Trouble>{trouble}</Trouble>
    </Confirm>
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

/** What a document expects in a cell: required with its source, or recommended. */
function Demand({ document }: { readonly document: ExpectedDocument }) {
  if (document.demand === null) {
    return null
  }

  return (
    <span className="flex flex-col items-start gap-0.5">
      <Status tone={document.demand === 'required' ? 'waiting' : 'neutral'}>
        {expectedDemandLabel[document.demand]}
      </Status>
      {document.source === null ? null : (
        <span className="text-[12px] text-ink-faint">{document.source}</span>
      )}
    </span>
  )
}

/**
 * The page of an own kind, `eigene_art()` of the boards: what it is called
 * and its cost group, its fields and the documents an asset of it is
 * expected to have, and that the catalogue proposes no duty for it.
 */
export function OwnKindScreen() {
  const { kindKey: part } = useParams({ strict: false }) as { kindKey: string }
  const kindKey = ownKindKeyOf(part)
  const catalogue = useCatalogue()
  const navigate = useNavigate()
  const { keeps, view } = useOwn()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [documenting, setDocumenting] = useState(false)
  const [editingField, setEditingField] = useState<OwnFieldView | null>(null)
  const [removingField, setRemovingField] = useState<OwnFieldView | null>(null)
  const [removingKind, setRemovingKind] = useState(false)
  const [removingDocument, setRemovingDocument] = useState<ExpectedDocument | null>(null)
  const kind = view.kinds.find((each) => each.key === kindKey)
  const fieldRemoval = useOwnKindRoute(() => {
    setRemovingField(null)
  })
  const kindRemoval = useOwnKindRoute(() => {
    setRemovingKind(false)
    void navigate({ to: ownKindPlaces.list })
  })
  const documentRemoval = useOwnKindRoute(() => {
    setRemovingDocument(null)
  })

  if (kind === undefined || !isOwnKind(kindKey)) {
    return <NotInCatalogue />
  }

  const kinds = catalogue?.assetKinds(today()) ?? []
  const carrying = kind.assets ?? 0

  return (
    <Screen>
      <PageHead
        title={kind.label}
        sub={ownKindScreenWords.sub}
        crumbs={[cataloguePlaces.list, { to: ownKindPlaces.list, label: ownPackageWords.title }]}
        actions={
          <>
            {kind.id === null ? null : <ChangesButton table="own_asset_kinds" id={kind.id} />}
            {keeps && kind.id !== null ? (
              <>
                <Button
                  icon={Trash2}
                  tone="danger"
                  disabled={carrying > 0}
                  onClick={() => {
                    setRemovingKind(true)
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
      <div className="grid items-start gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Anlagenart">
          <FactList
            keyWidth={110}
            facts={[
              { label: 'Bezeichnung', value: kind.label },
              { label: 'Kostengruppe', value: costGroupWords(kind.costGroup, kinds) },
              ...(kind.assets === null
                ? []
                : [{ label: 'Anlagen', value: assetsWords(kind.assets) }]),
            ]}
          />
          {keeps && carrying > 0 ? (
            <p className="text-[12px] text-ink-faint">
              {ownKindScreenWords.removeKind} {assetsWords(carrying)}{' '}
              {carrying === 1 ? 'trägt' : 'tragen'} sie.
            </p>
          ) : null}
        </Card>
        <div className="flex min-w-0 flex-col gap-3.5">
          <TablePanel
            title="Angaben"
            caption={`Angaben der Anlagenart ${kind.label}`}
            grow={false}
            note={ownKindScreenWords.fieldsNote}
            {...(keeps && kind.id !== null
              ? {
                  action: (
                    <Button
                      size="small"
                      icon={Plus}
                      onClick={() => {
                        setAdding(true)
                      }}
                    >
                      {ownKindWords.addField}
                    </Button>
                  ),
                }
              : {})}
            cards={kind.fields.map((field) => ({
              key: field.key,
              title: field.label,
              sub: [ownFieldSortLabel[field.sort], unitOrChoices(field)]
                .filter((part) => part !== '')
                .join(' · '),
            }))}
            cardsEmpty={<Empty>{ownKindScreenWords.noFieldsAtKind}</Empty>}
          >
            <thead>
              <tr>
                {/* Beside the column of 320 pixels a card has 692 at 1280: the least widths stay below. */}
                <Column className="min-w-[130px]">Angabe</Column>
                <Column className="w-[100px] min-w-[96px]">Sorte</Column>
                <Column className="min-w-[120px]">Einheit oder Auswahl</Column>
                {keeps ? (
                  <>
                    <Column numeric className="w-[80px] min-w-[70px]">
                      Mit Wert
                    </Column>
                    <Column className="w-[170px] min-w-[170px]">
                      <span className="sr-only">Ändern</span>
                    </Column>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {kind.fields.length === 0 ? (
                <tr>
                  <Cell>{ownKindScreenWords.noFieldsAtKind}</Cell>
                </tr>
              ) : (
                kind.fields.map((field) => (
                  <tr key={field.key}>
                    <Cell>{field.label}</Cell>
                    <Cell>{ownFieldSortLabel[field.sort]}</Cell>
                    <Cell>{unitOrChoices(field)}</Cell>
                    {keeps ? (
                      <>
                        <Cell numeric>{(field.values ?? 0).toLocaleString('de-DE')}</Cell>
                        <Cell>
                          <FieldActions
                            field={field}
                            onEdit={setEditingField}
                            onRemove={setRemovingField}
                          />
                        </Cell>
                      </>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </TablePanel>
          <TablePanel
            title="Unterlagen"
            caption={`Unterlagen der Anlagenart ${kind.label}`}
            grow={false}
            note={ownKindScreenWords.documentsNote}
            {...(keeps && kind.id !== null
              ? {
                  action: (
                    <Button
                      size="small"
                      icon={Plus}
                      onClick={() => {
                        setDocumenting(true)
                      }}
                    >
                      {ownKindWords.addDocument}
                    </Button>
                  ),
                }
              : {})}
            cards={kind.documents.map((document) => ({
              key: document.key,
              title: document.label,
              sub: [
                document.kind === null ? '' : documentKindLabel[document.kind],
                document.demand === null ? '' : expectedDemandLabel[document.demand],
                document.source ?? '',
              ]
                .filter((part) => part !== '')
                .join(' · '),
            }))}
            cardsEmpty={<Empty>{ownKindScreenWords.noDocuments}</Empty>}
          >
            <thead>
              <tr>
                <Column className="min-w-[160px]">Unterlage</Column>
                <Column className="w-[180px] min-w-[150px]">Art des Dokuments</Column>
                <Column className="min-w-[160px]">Verlangt oder empfohlen</Column>
                {keeps ? (
                  <Column className="w-[120px] min-w-[110px]">
                    <span className="sr-only">Ändern</span>
                  </Column>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {kind.documents.length === 0 ? (
                <tr>
                  <Cell>{ownKindScreenWords.noDocuments}</Cell>
                </tr>
              ) : (
                kind.documents.map((document) => (
                  <tr key={document.key}>
                    <Cell>{document.label}</Cell>
                    <Cell>{document.kind === null ? '' : documentKindLabel[document.kind]}</Cell>
                    <Cell>
                      <Demand document={document} />
                    </Cell>
                    {keeps ? (
                      <Cell>
                        <div className="flex justify-end">
                          <Button
                            size="small"
                            onClick={() => {
                              setRemovingDocument(document)
                            }}
                          >
                            Entfernen
                          </Button>
                        </div>
                      </Cell>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </TablePanel>
          <NoteBox tone="neutral">{ownKindScreenWords.duties}</NoteBox>
        </div>
      </div>
      {editing ? (
        <OwnKindDialog
          kind={kind}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : null}
      {adding ? (
        <OwnFieldDialog
          assetKind={kind.key}
          onClose={() => {
            setAdding(false)
          }}
        />
      ) : null}
      {documenting ? (
        <OwnDocumentDialog
          kind={kind}
          onClose={() => {
            setDocumenting(false)
          }}
        />
      ) : null}
      {editingField === null ? null : (
        <OwnFieldDialog
          key={editingField.key}
          field={editingField}
          onClose={() => {
            setEditingField(null)
          }}
        />
      )}
      <FieldRemoval
        field={removingField}
        working={fieldRemoval.working}
        trouble={fieldRemoval.trouble}
        onConfirm={(field) => {
          if (field.id !== null) {
            void fieldRemoval.run('DELETE', ownKindRoutes.field(field.id))
          }
        }}
        onCancel={() => {
          setRemovingField(null)
        }}
      />
      <Confirm
        open={removingKind}
        title={`${kind.label} entfernen?`}
        confirm={kindRemoval.working ? 'Einen Moment' : 'Entfernen'}
        tone="danger"
        onConfirm={() => {
          if (kind.id !== null) {
            void kindRemoval.run('DELETE', ownKindRoutes.kind(kind.id))
          }
        }}
        onCancel={() => {
          setRemovingKind(false)
        }}
      >
        <p>
          Keine Anlage trägt diese Art. Mit ihr gehen ihre Angaben; ihr Schlüssel bleibt vergeben.
        </p>
        <Trouble>{kindRemoval.trouble}</Trouble>
      </Confirm>
      <Confirm
        open={removingDocument !== null}
        title={`${removingDocument?.label ?? 'Unterlage'} entfernen?`}
        confirm={documentRemoval.working ? 'Einen Moment' : 'Entfernen'}
        tone="danger"
        onConfirm={() => {
          if (kind.id !== null && removingDocument !== null) {
            void documentRemoval.run('PATCH', ownKindRoutes.kind(kind.id), {
              expectedDocuments: kind.documents.filter(
                (document) => document.key !== removingDocument.key,
              ),
            })
          }
        }}
        onCancel={() => {
          setRemovingDocument(null)
        }}
      >
        <p>
          Die Akte einer Anlage dieser Art nennt sie dann nicht mehr. Dokumente bleiben, wo sie
          liegen.
        </p>
        <Trouble>{documentRemoval.trouble}</Trouble>
      </Confirm>
    </Screen>
  )
}
