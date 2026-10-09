import {
  type Catalogue,
  canonicalForm,
  formUnits,
  type RecordState,
  storedTemplate,
  type TemplateDefinition,
  type TemplateField,
  templateProblemLines,
  templateProblems,
  type TemplateRecords,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { count, flag, maybeText, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  AlignLeft,
  Camera,
  Check,
  ClipboardCheck,
  Gauge,
  Hash,
  List,
  type LucideIcon,
  Pencil,
  Plus,
  Thermometer,
  ToggleLeft,
  TriangleAlert,
  Type,
  Zap,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from 'react'

import { definitionOf } from '../../app/templates.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { kindOfDuty } from '../duty-words.js'
import { ChapterDialog, type PointChoices, PointDialog } from '../round-template-dialogs.js'
import {
  roundsPlace,
  takenFromWord,
  templateListPlace,
  templatePlaces,
} from '../round-template-addresses.js'
import {
  emptyTemplate,
  newPoint,
  nextKey,
  type PointKind,
  pointDetail,
  pointKindLabel,
  pointKindOf,
  sizeWords,
  withChapter,
  withoutChapter,
  withoutPoint,
  withPoint,
} from '../template-draft.js'
import { DropLine, type Reorder, useReorder } from '../template-reorder.js'
import { templateRoundsQuery, useTemplateVersions } from './round-templates.js'

/**
 * The template of a round in the office (#112, sections 2.5 and 4.5 of the
 * concept), as `vorlage()` of the boards draws it: the chapters with their
 * points, what each point asks, what it is about and the duty it fulfils;
 * beside them the versions with their rounds, whether the evidence waits for
 * a countersignature, and where the template was taken over from.
 *
 * Changing it is a draft until "Als neue Fassung speichern": the version it
 * began from stays, and a round on it stays on it. The draft is checked by
 * the same function as at the route, against the assets, rooms and duties of
 * this device, so a point at an asset that is gone stands out before anybody
 * saves, and a version the engine refuses names the point and why.
 */

export const templateWords = {
  gone: 'Den Datensatz gibt es nicht mehr',
  goneAsset: 'Anlage nicht gefunden',
  goneRoom: 'Raum nicht gefunden',
  stays: (next: number) =>
    `Ein laufender Rundgang bleibt auf seiner Fassung. Eine Änderung wird die Fassung ${String(next)}.`,
  unchanged: 'Keine Änderung, die zu speichern wäre.',
  notSaved: 'Die Vorlage ist nicht gespeichert.',
  offline: 'Ohne Verbindung wird eine Vorlage nicht gespeichert. Gerade ist keine da.',
  newer: (version: number) =>
    `Inzwischen ist die Fassung ${String(version)} gespeichert. Ihre Änderungen hier beziehen sich auf eine ältere.`,
  missing: 'Diese Vorlage gibt es nicht auf diesem Gerät.',
  noCatalogue: 'Diese Vorlage bringt kein Paket dieses Servers mit.',
  fromPackage:
    'Ein Paket kennt Ihre Anlagen nicht. Unter „Bearbeiten“ setzen Sie an jedem Punkt die Anlage oder den Raum und, wo er sie erfüllt, die Pflicht.',
  countersign: 'Gegenzeichnung der Objektleitung verlangt',
  countersignHint: 'Der Nachweis gilt erst mit beiden Unterschriften.',
} as const

const kindIcons: Readonly<Record<PointKind, LucideIcon>> = {
  check_point: Check,
  measurement: Thermometer,
  meter_reading: Gauge,
  photo: Camera,
  remark: AlignLeft,
  text: Type,
  number: Hash,
  choice: List,
  yes_no: ToggleLeft,
}

const pointKindNotes = [
  [
    'Prüfpunkt',
    'Nicht in Ordnung verlangt eine Bemerkung und wird mit der Unterschrift ein Mangel.',
  ],
  [
    'Messwert',
    'Mit Einheit und Grenzwert, aus einer Regel eines Pakets oder als eigener Wert mit Quelle.',
  ],
  [
    'Zählerstand',
    'Der abgelesene Stand, mit Einheit. An die Messstelle schreibt er, sobald die Zähler da sind.',
  ],
  ['Foto', 'Auf dem Gerät verkleinert, auch ohne Netz.'],
] as const

const live = (record: RecordState) =>
  record['deletedAt'] === null || record['deletedAt'] === undefined

/** What the editor knows about the records of this device: names, and what a check asks. */
function useTemplateRecords(catalogue: Catalogue | null): {
  readonly records: TemplateRecords
  readonly choices: PointChoices
  readonly labelOf: (kind: string, id: string) => string | null
  readonly dutyLabel: (id: string) => string | null
} {
  const assets = useRecords('assets')
  const rooms = useRecords('rooms')
  const duties = useRecords('duties')
  const on = today()

  return useMemo(() => {
    const assetLabel = (asset: RecordState) =>
      [maybeText(asset, 'number'), text(asset, 'name')].filter(Boolean).join(' ')
    const roomLabel = (room: RecordState) =>
      ['Raum', maybeText(room, 'number'), text(room, 'name')].filter(Boolean).join(' ')
    const liveAssets = new Map(assets.filter(live).map((each) => [String(each['id']), each]))
    const liveRooms = new Map(rooms.filter(live).map((each) => [String(each['id']), each]))
    const dutyName = (duty: RecordState) =>
      kindOfDuty(
        {
          kind: maybeText(duty, 'kind'),
          kindVersion: (duty['kindVersion'] as number | null | undefined) ?? null,
        },
        catalogue,
      )?.definition.label ??
      maybeText(duty, 'label') ??
      text(duty, 'kind')
    const takesRoundPoint = (duty: RecordState) => {
      const kind = kindOfDuty(
        {
          kind: maybeText(duty, 'kind'),
          kindVersion: (duty['kindVersion'] as number | null | undefined) ?? null,
        },
        catalogue,
      )

      return maybeText(duty, 'kind') === null
        ? true
        : kind !== null && kind.definition.evidence.kinds.includes('round_point')
    }
    // A duty that has ended is fulfilled by nothing any more, as `dutyHasEnded` says on the server.
    const openDuties = duties.filter((duty) => {
      const ends = maybeText(duty, 'endsOn')

      return live(duty) && (ends === null || ends > on)
    })
    const dutyById = new Map(openDuties.map((each) => [String(each['id']), each]))

    return {
      records: {
        record: (kind, id) => (kind === 'asset' ? liveAssets : liveRooms).has(id),
        duty: (id) => {
          const duty = dutyById.get(id)

          return duty === undefined
            ? null
            : {
                assetId: maybeText(duty, 'assetId'),
                roomId: maybeText(duty, 'roomId'),
                takesRoundPoint: takesRoundPoint(duty),
              }
        },
        ruleUnits: (key) => {
          const found = catalogue?.ruleRecords(key) ?? []

          return found.length === 0 ? null : found.map((rule) => rule.record.unit)
        },
      },
      choices: {
        assets: [...liveAssets.values()]
          .map((asset) => ({ value: String(asset['id']), label: assetLabel(asset) }))
          .sort((left, right) => left.label.localeCompare(right.label, 'de')),
        rooms: [...liveRooms.values()]
          .map((room) => ({ value: String(room['id']), label: roomLabel(room) }))
          .sort((left, right) => left.label.localeCompare(right.label, 'de')),
        duties: (kind, id) =>
          openDuties
            .filter(
              (duty) =>
                maybeText(duty, kind === 'asset' ? 'assetId' : 'roomId') === id &&
                takesRoundPoint(duty),
            )
            .map((duty) => ({ value: String(duty['id']), label: dutyName(duty) })),
        rules: (unit) => {
          const fits = (catalogue?.contents(on) ?? [])
            .flatMap((pack) => pack.rules)
            .filter((rule) => {
              const entry = formUnits[unit]
              const from = 'fromRule' in entry ? entry.fromRule : undefined

              return from !== undefined && rule.record.unit in from
            })
          const keys = [...new Set(fits.map((rule) => rule.record.key))]

          return keys.map((key) => {
            const record = catalogue?.rule(key, on)?.record

            return { value: key, label: record ? `${key}, ${record.source}` : key }
          })
        },
      },
      labelOf: (kind, id) => {
        const found = kind === 'asset' ? liveAssets.get(id) : liveRooms.get(id)

        return found === undefined ? null : kind === 'asset' ? assetLabel(found) : roomLabel(found)
      },
      dutyLabel: (id) => {
        const duty = dutyById.get(id)

        return duty === undefined ? null : dutyName(duty)
      },
    }
  }, [assets, rooms, duties, catalogue, on])
}

/** The page of a template, on the newest version as it stood when the page was opened. */
export function TemplateScreen() {
  const { templateId } = useParams({ strict: false }) as { templateId?: string }
  const templates = useRecords('round_templates')
  const versions = useTemplateVersions()
  const template = templates.find((each) => String(each['id']) === templateId) ?? null
  const all = templateId === undefined ? [] : (versions.get(templateId) ?? [])
  const newest = all[0] === undefined ? null : count(all[0], 'formVersion')
  // The version the editor began from, kept while somebody else saves
  // another, so that a draft is never laid over a version nobody here saw.
  const [opened, setOpened] = useState<number | null>(null)

  if (opened === null && newest !== null) {
    setOpened(newest)
  }

  const version = all.find((each) => count(each, 'formVersion') === opened)

  if (template === null || version === undefined || templateId === undefined) {
    return (
      <Screen>
        <PageHead title="Vorlage" crumbs={[roundsPlace, templateListPlace]} />
        <Panel>
          <Empty>{templateWords.missing}</Empty>
        </Panel>
      </Screen>
    )
  }

  return (
    <TemplateEditor
      key={`${templateId}:${String(opened)}`}
      templateId={templateId}
      template={template}
      version={version}
      versions={all}
      newest={newest ?? 0}
      onOpen={setOpened}
      onSaved={() => {
        setOpened(null)
      }}
    />
  )
}

/** A new template, empty or taken over from a package (section 5). */
export function NewTemplateScreen() {
  const search = useSearch({ strict: false }) as Readonly<Record<string, unknown>>
  const catalogue = useCatalogue()
  const navigate = useNavigate()
  const key = typeof search[takenFromWord] === 'string' ? search[takenFromWord] : null
  const source = key === null ? null : (catalogue?.roundTemplate(key, today()) ?? null)

  if (key !== null && source === null) {
    return (
      <Screen>
        <PageHead title="Neue Vorlage" crumbs={[roundsPlace, templateListPlace]} />
        <Panel>
          <Empty>{catalogue === null ? templateWords.missing : templateWords.noCatalogue}</Empty>
        </Panel>
      </Screen>
    )
  }

  return (
    <TemplateEditor
      key={key ?? 'empty'}
      templateId={null}
      template={null}
      version={null}
      versions={[]}
      newest={0}
      source={
        source === null
          ? null
          : {
              key: source.key,
              version: source.version,
              definition: storedTemplate(source.definition as TemplateDefinition),
            }
      }
      onSaved={(id) => {
        void navigate({ to: templatePlaces.template(id) })
      }}
    />
  )
}

interface Opening {
  readonly kind: 'point'
  readonly point: TemplateField
  readonly chapter: string
  readonly isNew: boolean
}

interface ChapterOpening {
  readonly kind: 'chapter'
  readonly key: string
  readonly isNew: boolean
}

function TemplateEditor({
  templateId,
  template,
  version,
  versions,
  newest,
  source = null,
  onOpen,
  onSaved,
}: {
  readonly templateId: string | null
  readonly template: RecordState | null
  readonly version: RecordState | null
  readonly versions: readonly RecordState[]
  readonly newest: number
  readonly source?: {
    readonly key: string
    readonly version: number
    readonly definition: TemplateDefinition
  } | null
  readonly onOpen?: (version: number) => void
  readonly onSaved: (id: string) => void
}) {
  const client = useSync()
  const keeps = useRight('template.write')
  const catalogue = useCatalogue()
  const on = today()
  const known = useTemplateRecords(catalogue)
  const rounds = useQuery({ ...templateRoundsQuery, enabled: templateId !== null })
  const began = version === null ? (source?.definition ?? emptyTemplate()) : definitionOf(version)
  const beganAsks = version === null ? false : flag(version, 'asksCountersignature')
  const [draft, setDraft] = useState<TemplateDefinition>(began)
  const [asks, setAsks] = useState(beganAsks)
  const [opening, setOpening] = useState<Opening | ChapterOpening | null>(null)
  const [tried, setTried] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rows = useRef<HTMLDivElement>(null)
  const reorder = useReorder(draft, setDraft, rows)

  const number = version === null ? 0 : count(version, 'formVersion')
  const changed =
    version === null || canonicalForm(draft) !== canonicalForm(began) || asks !== beganAsks
  const problems = templateProblems(draft, known.records)
  const roundsOn = (formVersion: number) =>
    (rounds.data ?? [])
      .filter((each) => each.templateId === templateId && each.formVersion === formVersion)
      .reduce((sum, each) => sum + each.rounds, 0)
  const sourceKey = version === null ? (source?.key ?? null) : maybeText(template, 'sourceKey')
  const sourceTitle =
    sourceKey === null
      ? null
      : (catalogue?.roundTemplate(sourceKey, on)?.definition.title ?? sourceKey)
  // The package by the part of the key before the dot, `<package>.<key>`.
  const sourcePackage =
    sourceKey === null
      ? null
      : (catalogue?.packages.find((pack) => sourceKey.startsWith(`${pack.name}.`))?.title ?? null)
  const sourceVersion =
    version === null ? (source?.version ?? null) : (template?.['sourceVersion'] as number | null)

  const save = async () => {
    setTried(true)

    if (Object.keys(problems).length > 0) {
      setRefusal(templateProblemLines(draft, problems).join(' '))
      return
    }

    setSaving(true)

    const result =
      templateId === null
        ? await makeAt(client, '/round-templates', {
            definition: draft,
            asksCountersignature: asks,
            ...(source === null ? {} : { sourceKey: source.key }),
          })
        : await askAt(client, 'POST', `/round-templates/${templateId}/versions`, templateId, {
            definition: draft,
            asksCountersignature: asks,
            basedOn: number,
          })

    setSaving(false)

    if (result.outcome === 'refused') {
      setRefusal(result.message ?? templateWords.offline)
      return
    }

    onSaved(result.id)
  }

  const shownProblem = (place: string) =>
    place.startsWith('point.') || tried ? (problems[place] ?? null) : null

  const title =
    version === null ? 'Neue Vorlage' : text(template, 'title') || definitionOf(version).title

  return (
    <Screen>
      <PageHead
        title={title}
        crumbs={[roundsPlace, templateListPlace]}
        badges={
          version === null ? null : roundsOn(number) > 0 ? (
            <Status tone="done" icon={Check}>
              Fassung {String(number)} in Gebrauch
            </Status>
          ) : (
            <Status tone="neutral">Fassung {String(number)}</Status>
          )
        }
        sub={
          version === null
            ? source === null
              ? `Noch nicht gespeichert, ${sizeWords(draft)}`
              : `Aus einem Paket übernommen, noch nicht gespeichert, ${sizeWords(draft)}`
            : `Vorlage eines Rundgangs, ${sizeWords(draft)}`
        }
        actions={
          <>
            {templateId === null ? null : <ChangesButton table="round_templates" id={templateId} />}
            {keeps ? (
              <>
                <Button
                  icon={Plus}
                  onClick={() => {
                    setOpening({ kind: 'chapter', key: nextKey(draft, 'k'), isNew: true })
                  }}
                >
                  Kapitel hinzufügen
                </Button>
                <Button
                  tone="primary"
                  icon={Check}
                  disabled={!changed || saving}
                  onClick={() => {
                    void save()
                  }}
                >
                  {version === null ? 'Als Fassung 1 speichern' : 'Als neue Fassung speichern'}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {newest > number && onOpen !== undefined ? (
        <NoteBox
          tone="waiting"
          action={
            <Button
              size="small"
              onClick={() => {
                onOpen(newest)
              }}
            >
              Fassung {String(newest)} öffnen
            </Button>
          }
        >
          {templateWords.newer(newest)}
        </NoteBox>
      ) : null}
      {refusal === null ? null : (
        <NoteBox tone="conflict" icon={TriangleAlert}>
          <span role="alert">
            {templateWords.notSaved} {refusal}
          </span>
        </NoteBox>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <Panel className="min-w-0">
          <div ref={rows} className="flex flex-col gap-[18px]">
            {keeps ? (
              <TitleField
                value={draft.title}
                problem={shownProblem('title')}
                onChange={(value) => {
                  setDraft({ ...draft, title: value })
                }}
              />
            ) : null}
            {draft.sections.map((section) => (
              <Chapter
                key={section.key}
                section={section}
                keeps={keeps}
                reorder={reorder}
                problem={shownProblem(`chapter.${section.key}`)}
                pointProblem={(key) => shownProblem(`point.${key}`)}
                detail={(field) => pointDetail(field, catalogue, on)}
                labelOf={known.labelOf}
                dutyLabel={known.dutyLabel}
                onEditChapter={() => {
                  setOpening({ kind: 'chapter', key: section.key, isNew: false })
                }}
                onAddPoint={() => {
                  setOpening({
                    kind: 'point',
                    point: newPoint('check_point', nextKey(draft, 'p')),
                    chapter: section.key,
                    isNew: true,
                  })
                }}
                onEditPoint={(point) => {
                  setOpening({ kind: 'point', point, chapter: section.key, isNew: false })
                }}
              />
            ))}
            {tried && problems['form'] !== undefined ? (
              <p className="text-[13px] font-medium text-conflict">{problems['form']}</p>
            ) : null}
            {reorder.said}
          </div>
        </Panel>
        <div className="flex min-w-0 flex-col gap-3.5">
          {version === null ? null : (
            <TablePanel
              title="Fassungen"
              caption="Fassungen der Vorlage mit dem Tag, seit dem sie gelten, und den Rundgängen auf ihnen"
              note={templateWords.stays(newest + 1)}
            >
              <thead>
                <tr>
                  <Column className="w-[70px]">Fassung</Column>
                  <Column>Gültig</Column>
                  <Column numeric className="w-[80px]">
                    Rundgänge
                  </Column>
                </tr>
              </thead>
              <tbody>
                {versions.map((each, index) => {
                  const after = versions[index - 1]
                  const from = date(each['createdAt'])

                  return (
                    <tr key={String(each['id'])}>
                      <Cell className={index === 0 ? 'font-semibold' : undefined}>
                        {String(count(each, 'formVersion'))}
                      </Cell>
                      <Cell>
                        {after === undefined
                          ? `seit ${from}`
                          : `${from} bis ${date(after['createdAt'])}`}
                      </Cell>
                      <Cell numeric>
                        {rounds.data === undefined
                          ? ''
                          : String(roundsOn(count(each, 'formVersion')))}
                      </Cell>
                    </tr>
                  )
                })}
              </tbody>
            </TablePanel>
          )}
          <Panel title="Vorlage">
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2.5 text-[14px] leading-[1.4]">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-solid"
                  checked={asks}
                  disabled={!keeps}
                  onChange={(event) => {
                    setAsks(event.target.checked)
                  }}
                />
                <span>
                  {templateWords.countersign}
                  <span className="block text-[12px] text-ink-muted">
                    {templateWords.countersignHint}
                  </span>
                </span>
              </label>
              {sourceKey === null ? null : (
                <FactList
                  keyWidth={90}
                  facts={[
                    {
                      label: 'Übernommen',
                      value: `aus dem Paket${sourcePackage === null ? '' : ` ${sourcePackage}`}, „${String(sourceTitle)}“${sourceVersion === null ? '' : `, Fassung ${String(sourceVersion)}`}`,
                    },
                  ]}
                />
              )}
            </div>
          </Panel>
          {version === null && source !== null ? (
            <NoteBox>{templateWords.fromPackage}</NoteBox>
          ) : null}
          <Panel title="Arten von Punkten">
            <div className="flex flex-col gap-2">
              {pointKindNotes.map(([kind, note]) => (
                <p key={kind} className="text-[13px] leading-[1.4]">
                  <span className="font-semibold">{kind}.</span> {note}
                </p>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      {opening?.kind === 'point' ? (
        <PointDialog
          point={opening.point}
          chapter={opening.chapter}
          draft={draft}
          isNew={opening.isNew}
          records={known.records}
          choices={known.choices}
          onApply={(point, chapter) => {
            setDraft(withPoint(draft, point, chapter))
            setOpening(null)
          }}
          onRemove={() => {
            setDraft(withoutPoint(draft, opening.point.key))
            setOpening(null)
          }}
          onClose={() => {
            setOpening(null)
          }}
        />
      ) : null}
      {opening?.kind === 'chapter' ? (
        <ChapterDialog
          title={draft.sections.find((section) => section.key === opening.key)?.title ?? ''}
          points={draft.sections.find((section) => section.key === opening.key)?.fields.length ?? 0}
          isNew={opening.isNew}
          onApply={(chapterTitle) => {
            setDraft(withChapter(draft, opening.key, chapterTitle))
            setOpening(null)
          }}
          onRemove={() => {
            setDraft(withoutChapter(draft, opening.key))
            setOpening(null)
          }}
          onClose={() => {
            setOpening(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

function TitleField({
  value,
  problem,
  onChange,
}: {
  readonly value: string
  readonly problem: string | null
  readonly onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-medium">
      <span>
        Bezeichnung{' '}
        <span className="text-conflict" aria-hidden="true">
          *
        </span>
      </span>
      <input
        className="h-[34px] rounded border border-strong bg-input px-2.5 text-[14px] font-normal"
        value={value}
        required
        aria-invalid={problem !== null}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      {problem === null ? null : (
        <span className="text-[12px] font-medium text-conflict">{problem}</span>
      )}
    </label>
  )
}

function Chapter({
  section,
  keeps,
  reorder,
  problem,
  pointProblem,
  detail,
  labelOf,
  dutyLabel,
  onEditChapter,
  onAddPoint,
  onEditPoint,
}: {
  readonly section: TemplateDefinition['sections'][number]
  readonly keeps: boolean
  readonly reorder: Reorder
  readonly problem: string | null
  readonly pointProblem: (key: string) => string | null
  readonly detail: (field: TemplateField) => string
  readonly labelOf: (kind: string, id: string) => string | null
  readonly dutyLabel: (id: string) => string | null
  readonly onEditChapter: () => void
  readonly onAddPoint: () => void
  readonly onEditPoint: (point: TemplateField) => void
}) {
  const lifted = reorder.lifted('chapter', section.key)
  const drop = reorder.drop('point')
  const style: CSSProperties = {
    transform: `translateY(${String(reorder.offset('chapter', section.key))}px)`,
  }
  let standing = 0
  const rows: ReactNode[] = []

  for (const field of section.fields) {
    if (drop !== null && drop.chapter === section.key && drop.index === standing) {
      rows.push(<DropLine key={`drop-${field.key}`} />)
    }

    rows.push(
      <PointRow
        key={field.key}
        field={field}
        keeps={keeps}
        reorder={reorder}
        problem={pointProblem(field.key)}
        detail={detail(field)}
        target={
          field.about === undefined
            ? null
            : { kind: field.about.kind, label: labelOf(field.about.kind, field.about.id) }
        }
        duty={field.fulfils === undefined ? null : (dutyLabel(field.fulfils) ?? '')}
        onEdit={() => {
          onEditPoint(field)
        }}
      />,
    )

    if (reorder.lifted('point', field.key) === null) {
      standing += 1
    }
  }

  if (drop !== null && drop.chapter === section.key && drop.index >= standing) {
    rows.push(<DropLine key="drop-end" />)
  }

  return (
    <section data-chapter={section.key} className={lifted ?? undefined} style={style}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-1 pb-2 pt-1">
        {keeps ? reorder.handle('chapter', section.key, `Kapitel ${section.title}`) : null}
        <h3 className="m-0 min-w-0 grow basis-[120px] text-[14px] font-semibold [overflow-wrap:anywhere]">
          {section.title}
        </h3>
        {keeps ? (
          <>
            <Button size="small" icon={Pencil} onClick={onEditChapter}>
              Bearbeiten
            </Button>
            <Button size="small" icon={Plus} onClick={onAddPoint}>
              Punkt hinzufügen
            </Button>
          </>
        ) : null}
      </div>
      {problem === null ? null : (
        <p className="px-1 pt-1.5 text-[12px] font-medium text-conflict">{problem}</p>
      )}
      <div data-chapter-body={section.key} className="min-h-3">
        {rows}
      </div>
    </section>
  )
}

function PointRow({
  field,
  keeps,
  reorder,
  problem,
  detail,
  target,
  duty,
  onEdit,
}: {
  readonly field: TemplateField
  readonly keeps: boolean
  readonly reorder: Reorder
  readonly problem: string | null
  readonly detail: string
  readonly target: { readonly kind: string; readonly label: string | null } | null
  readonly duty: string | null
  readonly onEdit: () => void
}) {
  const Icon = kindIcons[pointKindOf(field)]
  const lifted = reorder.lifted('point', field.key)
  const offset = reorder.offset('point', field.key)

  return (
    <div
      data-point={field.key}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-[9px] ${lifted ?? 'border-b border-row'}`}
      style={offset === 0 ? undefined : { transform: `translate(14px, ${String(offset)}px)` }}
    >
      {keeps ? reorder.handle('point', field.key, field.label) : null}
      <span className="inline-flex w-[118px] shrink-0 items-center gap-[5px] text-[12px] font-semibold text-ink-muted">
        <Icon size={14} strokeWidth={2.1} aria-hidden="true" />
        {pointKindLabel(field)}
      </span>
      <div className="min-w-0 grow basis-[180px] leading-[1.35]">
        <div className="text-[13px] font-medium [overflow-wrap:anywhere]">{field.label}</div>
        <div className="text-[12px] text-ink-faint">{detail}</div>
        {problem === null ? null : (
          <div className="text-[12px] font-medium text-conflict">{problem}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {target === null ? null : target.label === null ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border border-conflict-edge bg-conflict-fill px-1.5 py-px text-[12px] font-semibold text-conflict">
            <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
            {target.kind === 'asset' ? templateWords.goneAsset : templateWords.goneRoom}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
            <Zap size={12} strokeWidth={2.2} aria-hidden="true" />
            {target.label}
          </span>
        )}
        {duty === null ? null : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border border-done-edge bg-done-fill px-1.5 py-px text-[12px] font-semibold text-done">
            <ClipboardCheck size={12} strokeWidth={2.2} aria-hidden="true" />
            erfüllt {duty}
          </span>
        )}
      </div>
      {keeps ? (
        <Button size="small" icon={Pencil} onClick={onEdit}>
          Bearbeiten
        </Button>
      ) : null}
    </div>
  )
}
