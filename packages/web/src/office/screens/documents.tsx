import {
  type DocumentHome,
  documentHomeOf,
  type DocumentKind,
  documentKindLabel,
  documentKinds,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { openVersion, useVersions } from '@opengewerk/platform-web/attachments'
import { fileSize } from '@opengewerk/platform-web/format'
import { ChangesButton, Chip, Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { count, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Eye, FileText, Pencil, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import {
  documentHomeLabel,
  documentWords,
  filedOn,
  fileVersion,
  type HangsOn,
  hangsOn,
  kindWordsOf,
  newestFirst,
} from '../../app/documents.js'
import {
  type DocumentFilter,
  documentFilterOf,
  documentPlaces,
  documentRegisterPlace,
  documentSearch,
} from '../document-addresses.js'
import {
  EditDocumentDialog,
  RemoveDocumentConfirm,
  UploadDocumentDialog,
  useDocumentSurroundings,
} from '../documents.js'
import { defectPlaces } from '../defect-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { RegisterFilter } from '../register-filter.js'

export const documentRegisterWords = {
  none: 'Noch ist kein Dokument abgelegt.',
  nothingPasses: 'Kein Dokument passt zu dem, wonach die Liste eingegrenzt ist.',
  gone: 'Dieses Dokument gibt es nicht, oder es ist aus der Ablage entfernt worden.',
  whatAVersionIs:
    'Eine neue Fassung legt sich über die alte; die alte bleibt lesbar. Dateien von außen werden an ihren ersten Bytes geprüft.',
  everything: 'Allem',
  order: 'das zuletzt geänderte zuerst',
} as const

const counted = (found: number) =>
  found === 0
    ? 'Kein Dokument'
    : `${found.toLocaleString('de-DE')} ${found === 1 ? 'Dokument' : 'Dokumente'}`

const homes: readonly DocumentHome[] = [
  'propertyId',
  'buildingId',
  'roomId',
  'assetId',
  'activityId',
  'defectId',
]

/** Where the record a document hangs on is opened; an activity has no page yet. */
function pageOf(at: HangsOn): string | null {
  switch (at.home) {
    case 'propertyId':
      return officePlaces.property(at.id)
    case 'buildingId':
      return officePlaces.building(at.id)
    case 'roomId':
      return officePlaces.room(at.id)
    case 'assetId':
      return officePlaces.asset(at.id)
    case 'activityId':
      return null
    case 'defectId':
      return defectPlaces.defect(at.id)
  }
}

/**
 * "Dokumente" in the office, `dokumente()` of the boards (4.10 of the
 * concept): every document of the operator the person sees, with its kind,
 * what it hangs on, how many versions it has and when it was changed last,
 * and beside the list the versions of the one that is chosen.
 *
 * Read from the device, which holds the documents of its areas with their
 * versions, the rows and never the bytes: a file is fetched when somebody
 * opens it, through its version, and the server asks then whether the person
 * sees what the document hangs on. So the list stands without a connection,
 * and a document filed without one stands in it at once.
 *
 * What the list is narrowed by stands in the address, and so does the
 * document that is chosen (`document-addresses.ts`). The first of the list
 * is chosen until somebody chooses another; on a phone its versions stand
 * under the list, and above the list once a document is chosen.
 */
export function DocumentsScreen() {
  const { documentId } = useParams({ strict: false }) as { documentId?: string }
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const client = useSync()
  const files = useRight('document.record')
  const removes = useRight('document.remove')
  const documents = useRecords('attachments')
  const versions = useVersions()
  const around = useDocumentSurroundings()
  const [doing, setDoing] = useState<'file' | 'edit' | 'remove' | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const next = useRef<HTMLInputElement>(null)

  const filter = documentFilterOf(search)
  const narrowed = filter.kind !== undefined || filter.home !== undefined
  const listed = useMemo(
    () =>
      newestFirst(
        documents.filter(
          (document) =>
            (filter.kind === undefined || document['kind'] === filter.kind) &&
            (filter.home === undefined || documentHomeOf(document) === filter.home),
        ),
        versions,
      ),
    [documents, versions, filter.kind, filter.home],
  )
  const asked = documentId === undefined ? null : documents.find((one) => one['id'] === documentId)
  const chosen = asked ?? (documentId === undefined ? (listed[0] ?? null) : null)
  const chosenId = chosen ? String(chosen['id']) : null
  const itsVersions = chosenId === null ? [] : (versions.get(chosenId) ?? [])

  const show = (to: DocumentFilter) => {
    void navigate({
      to: documentId === undefined ? documentRegisterPlace.to : documentPlaces.document(documentId),
      search: documentSearch(to),
      replace: true,
    })
  }
  const stopDoing = () => {
    setDoing(null)
  }

  async function lay(chosenFiles: FileList | null) {
    const file = chosenFiles?.[0]

    // A dialog closed without a choice is no answer.
    if (!file || chosenId === null) {
      return
    }

    setTrouble(await fileVersion(client, chosenId, file))
  }

  const rowOf = (document: RecordState) => {
    const id = String(document['id'])
    const all = versions.get(id) ?? []
    const newest = all[0]
    const at = hangsOn(document, around)
    const page = pageOf(at)

    return { id, all, newest, at, page, title: text(document, 'title') }
  }

  return (
    <Screen>
      <PageHead
        title="Dokumente"
        count={counted(documents.length)}
        // On a phone a chosen document stands above the list: the way back
        // leads to the list as it was narrowed, with nothing chosen.
        {...(documentId === undefined
          ? {}
          : {
              phoneBack: {
                to: documentRegisterPlace.to,
                label: documentRegisterPlace.label,
              },
            })}
        actions={
          files ? (
            <Button
              tone="primary"
              icon={Upload}
              onClick={() => {
                setDoing('file')
              }}
            >
              Hochladen
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div role="group" aria-label="Art" className="flex flex-wrap gap-1.5">
          <Chip
            pressed={filter.kind === undefined}
            onPress={() => {
              const { kind: _, ...rest } = filter

              show(rest)
            }}
          >
            Alle
          </Chip>
          {documentKinds.map((kind: DocumentKind) => (
            <Chip
              key={kind}
              pressed={filter.kind === kind}
              onPress={() => {
                show({ ...filter, kind })
              }}
            >
              {documentKindLabel[kind]}
            </Chip>
          ))}
        </div>
        <span className="grow max-lg:hidden" />
        <RegisterFilter
          label="Hängt an"
          className="lg:w-[150px]"
          value={filter.home ?? ''}
          onChange={(value) => {
            const { home: _, ...rest } = filter

            show(value === '' ? rest : { ...rest, home: value as DocumentHome })
          }}
        >
          <option value="">{documentRegisterWords.everything}</option>
          {homes.map((home) => (
            <option key={home} value={home}>
              {documentHomeLabel[home]}
            </option>
          ))}
        </RegisterFilter>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          {listed.length === 0 ? (
            <Panel>
              <Empty>
                {narrowed ? documentRegisterWords.nothingPasses : documentRegisterWords.none}
              </Empty>
            </Panel>
          ) : (
            <TablePanel
              caption="Dokumente mit Art, woran sie hängen, Fassung und Tag der letzten Änderung"
              cards={listed.map((document) => {
                const row = rowOf(document)

                return {
                  key: row.id,
                  title: (
                    <Link
                      to={documentPlaces.document(row.id)}
                      search={documentSearch(filter)}
                      className={cardLink}
                    >
                      {row.title}
                    </Link>
                  ),
                  sub: [kindWordsOf(document, row.newest), row.at.words]
                    .filter((part) => part !== '')
                    .join(' · '),
                  right: `Fassung ${String(Math.max(row.all.length, 1))}`,
                }
              })}
              footer={
                <span>
                  {narrowed
                    ? `${listed.length.toLocaleString('de-DE')} von ${documents.length.toLocaleString('de-DE')}, `
                    : ''}
                  {documentRegisterWords.order}
                </span>
              }
            >
              <thead>
                <tr>
                  {/* Beside the versions the list has 683 pixels at 1280: the
                      four narrow columns leave the name of a document the rest. */}
                  <Column className="min-w-[160px]">Dokument</Column>
                  <Column className="w-[132px] min-w-[104px]">Art</Column>
                  <Column className="w-[176px] min-w-[128px]">Hängt an</Column>
                  <Column className="w-[82px] min-w-[76px]">Fassung</Column>
                  <Column className="w-[98px] min-w-[88px]">Geändert</Column>
                </tr>
              </thead>
              <tbody>
                {listed.map((document) => {
                  const row = rowOf(document)

                  return (
                    <tr
                      key={row.id}
                      aria-current={row.id === chosenId ? 'true' : undefined}
                      className={row.id === chosenId ? 'bg-surface-sunken' : undefined}
                    >
                      <Cell>
                        <div className="flex items-center gap-[9px]">
                          <FileText
                            size={18}
                            strokeWidth={1.9}
                            aria-hidden="true"
                            className="shrink-0 text-ink-muted"
                          />
                          <div className="min-w-0 leading-[1.32]">
                            <div className="font-medium">
                              <Link
                                to={documentPlaces.document(row.id)}
                                search={documentSearch(filter)}
                                className="text-inherit"
                              >
                                {row.title}
                              </Link>
                            </div>
                            <div className="text-[12px] text-ink-faint [overflow-wrap:anywhere]">
                              {row.newest
                                ? `${text(row.newest, 'fileName')}, ${fileSize(count(row.newest, 'sizeBytes'))}`
                                : documentWords.onItsWay}
                            </div>
                          </div>
                        </div>
                      </Cell>
                      <Cell>{kindWordsOf(document, row.newest)}</Cell>
                      <Cell>
                        {row.page ? <Link to={row.page}>{row.at.words}</Link> : row.at.words}
                      </Cell>
                      <Cell>{`Fassung ${String(Math.max(row.all.length, 1))}`}</Cell>
                      <Cell>{row.newest ? filedOn(client, row.newest) : ''}</Cell>
                    </tr>
                  )
                })}
              </tbody>
            </TablePanel>
          )}
        </div>
        {/* The first of the list is chosen until somebody chooses another, at
            every width. On a phone its versions stand under the list, and
            above it once somebody chose a document. */}
        <div className={documentId === undefined ? 'min-w-0' : 'min-w-0 max-lg:order-first'}>
          <Panel title="Fassungen">
            {chosen === null || chosenId === null ? (
              <Empty>
                {documentId === undefined ? documentRegisterWords.none : documentRegisterWords.gone}
              </Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="leading-[1.35]">
                  <h3 className="text-[14px] font-semibold [overflow-wrap:anywhere]">
                    {text(chosen, 'title')}
                  </h3>
                  <ChosenPlace
                    document={chosen}
                    newest={itsVersions[0]}
                    at={hangsOn(chosen, around)}
                  />
                </div>
                {itsVersions.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">{documentWords.onItsWay}</p>
                ) : (
                  <TablePanel caption={`Fassungen von ${text(chosen, 'title')}`}>
                    <thead>
                      <tr>
                        <Column className="w-[72px]">Fassung</Column>
                        <Column>Datei</Column>
                      </tr>
                    </thead>
                    <tbody>
                      {itsVersions.map((version, index) => (
                        <tr key={String(version['id'])}>
                          <Cell className={index === 0 ? 'font-semibold' : undefined}>
                            {String(itsVersions.length - index)}
                          </Cell>
                          <Cell>
                            <div className="leading-[1.32]">
                              <button
                                type="button"
                                className="cursor-pointer text-left text-inherit underline underline-offset-2 [overflow-wrap:anywhere]"
                                aria-label={`Fassung ${String(itsVersions.length - index)} öffnen: ${text(version, 'fileName')}`}
                                onClick={() => {
                                  void openVersion(client, version)
                                }}
                              >
                                {text(version, 'fileName')}
                              </button>
                              {/* The size, and the day it was filed: the day and never the time of day. */}
                              <div className="text-[12px] text-ink-faint">
                                {`${fileSize(count(version, 'sizeBytes'))}, ${filedOn(client, version)}`}
                              </div>
                            </div>
                          </Cell>
                        </tr>
                      ))}
                    </tbody>
                  </TablePanel>
                )}
                {trouble ? (
                  <p role="alert" className="text-[13px] font-semibold text-conflict">
                    {trouble}
                  </p>
                ) : null}
                <input
                  ref={next}
                  type="file"
                  className="sr-only"
                  aria-label="Neue Fassung wählen"
                  tabIndex={-1}
                  onChange={(event) => {
                    void lay(event.target.files)
                    event.target.value = ''
                  }}
                />
                <div className="flex flex-wrap gap-1.5">
                  {files ? (
                    <Button
                      size="small"
                      icon={Upload}
                      onClick={() => {
                        setTrouble(null)
                        next.current?.click()
                      }}
                    >
                      Neue Fassung hochladen
                    </Button>
                  ) : null}
                  {itsVersions[0] ? (
                    <Button
                      size="small"
                      icon={Eye}
                      onClick={() => {
                        const newest = itsVersions[0]

                        if (newest) {
                          void openVersion(client, newest)
                        }
                      }}
                    >
                      Öffnen
                    </Button>
                  ) : null}
                  {files ? (
                    <Button
                      size="small"
                      icon={Pencil}
                      onClick={() => {
                        setDoing('edit')
                      }}
                    >
                      Bearbeiten
                    </Button>
                  ) : null}
                  {removes ? (
                    <Button
                      size="small"
                      tone="danger"
                      icon={Trash2}
                      onClick={() => {
                        setDoing('remove')
                      }}
                    >
                      Entfernen
                    </Button>
                  ) : null}
                </div>
                <p className="text-[12px] leading-[1.4] text-ink-faint">
                  {documentRegisterWords.whatAVersionIs}
                </p>
                <div className="flex">
                  <ChangesButton table="attachments" id={chosenId} />
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
      {doing === 'file' ? <UploadDocumentDialog onClose={stopDoing} /> : null}
      {doing === 'edit' && chosen ? (
        <EditDocumentDialog key={chosenId} document={chosen} onClose={stopDoing} />
      ) : null}
      {doing === 'remove' && chosen ? (
        <RemoveDocumentConfirm
          document={chosen}
          onClose={stopDoing}
          onRemoved={() => {
            // Gone from the list: back to the list as it was narrowed.
            void navigate({
              to: documentRegisterPlace.to,
              search: documentSearch(filter),
              replace: true,
            })
          }}
        />
      ) : null}
    </Screen>
  )
}

/** Under the name of the chosen document: its kind, and what it hangs on, with the way there. */
function ChosenPlace({
  document,
  newest,
  at,
}: {
  readonly document: RecordState
  readonly newest: RecordState | undefined
  readonly at: HangsOn
}) {
  const page = pageOf(at)

  return (
    <div className="text-[12px] text-ink-faint">
      {kindWordsOf(document, newest)}
      {' · '}
      {page ? (
        <Link to={page} className={factLink}>
          {at.words}
        </Link>
      ) : (
        at.words
      )}
    </div>
  )
}
