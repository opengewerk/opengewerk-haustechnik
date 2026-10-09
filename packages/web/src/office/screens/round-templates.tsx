import type { CatalogueEntry, PackagedForm, RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { count, flag, request, text, useRecords } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Copy, Plus } from 'lucide-react'
import { useMemo } from 'react'

import { ReviewMarks } from '../../app/review-marks.js'
import { definitionOf } from '../../app/templates.js'
import { catalogueAbsenceWords, useCatalogue, useCatalogueAbsence } from '../../sync/catalogue.js'
import {
  roundsPlace,
  takenFromWord,
  templateListPlace,
  templatePlaces,
} from '../round-template-addresses.js'
import { sizeWords } from '../template-draft.js'

/**
 * The templates of the rounds (#112, sections 4.5 and 5 of the concept), as
 * `vorlagen()` of the boards draws them: the operator's own with the version
 * that stands, whether a round of it asks for a countersignature and how many
 * rounds stand on it, and below them the templates the packages bring, to
 * take over and adapt.
 *
 * Read by everybody who sees the activities, out of the sync like on a
 * device; made and taken over by whoever keeps the templates (section 7).
 */

export const templateListWords = {
  none: 'Noch gibt es keine Vorlage. Legen Sie eine an oder übernehmen Sie eine aus einem Paket.',
  stays: 'Ein laufender Rundgang bleibt auf der Fassung, in der er begann.',
  noPackaged: 'Die Pakete dieses Servers bringen keine Vorlagen mit.',
  takeOver: 'Übernehmen und anpassen',
  takenOver:
    'Eine übernommene Vorlage ist Ihre eigene. Ein Paket kennt Ihre Anlagen nicht: das Ziel und die Pflicht setzen Sie an jedem Punkt.',
} as const

/** How many rounds stand on a version of a template, as the server counts them in the areas of the person. */
export interface TemplateRounds {
  readonly templateId: string
  readonly formVersion: number
  readonly rounds: number
}

export const templateRoundsQuery = {
  queryKey: ['round-templates', 'rounds'],
  queryFn: () => request<TemplateRounds[]>('/round-templates/rounds'),
} as const

/** The versions of each template in the store, the newest first. */
export function useTemplateVersions(): ReadonlyMap<string, readonly RecordState[]> {
  const versions = useRecords('round_template_versions')

  return useMemo(() => {
    const grouped = new Map<string, RecordState[]>()

    for (const version of versions) {
      const of = text(version, 'templateId')

      grouped.set(of, [...(grouped.get(of) ?? []), version])
    }

    for (const each of grouped.values()) {
      each.sort((left, right) => count(right, 'formVersion') - count(left, 'formVersion'))
    }

    return grouped
  }, [versions])
}

const counted = (found: number) =>
  found === 0 ? 'Keine Vorlage' : `${String(found)} ${found === 1 ? 'Vorlage' : 'Vorlagen'}`

export function TemplateListScreen() {
  const keeps = useRight('template.write')
  const navigate = useNavigate()
  const catalogue = useCatalogue()
  const absence = useCatalogueAbsence()
  const on = today()
  const templates = useRecords('round_templates')
  const versions = useTemplateVersions()
  const rounds = useQuery(templateRoundsQuery)
  const packaged = useMemo(
    () =>
      (catalogue?.contents(on) ?? []).flatMap((pack) =>
        pack.roundTemplates.map((entry: CatalogueEntry<PackagedForm>) => ({ pack, entry })),
      ),
    [catalogue, on],
  )
  const rows = useMemo(
    () =>
      templates
        .map((template) => {
          const id = String(template['id'])
          const newest = versions.get(id)?.[0]

          return {
            id,
            title: text(template, 'title'),
            newest,
            rounds: (rounds.data ?? [])
              .filter((each) => each.templateId === id)
              .reduce((sum, each) => sum + each.rounds, 0),
          }
        })
        .sort((left, right) => left.title.localeCompare(right.title, 'de')),
    [templates, versions, rounds.data],
  )

  return (
    <Screen>
      <PageHead
        title={templateListPlace.label}
        crumbs={[roundsPlace]}
        count={counted(rows.length)}
        actions={
          keeps ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                void navigate({ to: templatePlaces.new })
              }}
            >
              Neue Vorlage
            </Button>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Panel>
          <Empty>{templateListWords.none}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Vorlagen der Rundgänge mit Fassung, Gegenzeichnung und Zahl der Rundgänge"
          note={templateListWords.stays}
          cards={rows.map((row) => ({
            key: row.id,
            title: <Link to={templatePlaces.template(row.id)}>{row.title}</Link>,
            sub: sizeWords(definitionOf(row.newest)),
            right: `Fassung ${String(count(row.newest, 'formVersion'))}`,
          }))}
        >
          <thead>
            <tr>
              <Column>Vorlage</Column>
              <Column className="w-[190px]">Fassung</Column>
              <Column className="w-[150px]">Gegenzeichnung</Column>
              <Column numeric className="w-[100px]">
                Rundgänge
              </Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <Link to={templatePlaces.template(row.id)} className="font-medium">
                      {row.title}
                    </Link>
                    <div className="text-[12px] text-ink-faint">
                      {sizeWords(definitionOf(row.newest))}
                    </div>
                  </div>
                </Cell>
                <Cell>
                  <div className="leading-[1.32]">
                    <div className="font-medium">
                      Fassung {String(count(row.newest, 'formVersion'))}
                    </div>
                    <div className="text-[12px] text-ink-faint">
                      seit {date(row.newest?.['createdAt'])}
                    </div>
                  </div>
                </Cell>
                <Cell>{flag(row.newest, 'asksCountersignature') ? 'verlangt' : 'nein'}</Cell>
                <Cell numeric>{rounds.data === undefined ? '' : String(row.rounds)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <TablePanel
        title="Vorlagen aus Paketen"
        caption="Vorlagen, die die Pakete dieses Servers mitbringen, mit Paket und Zahl der Punkte"
        note={packaged.length === 0 ? undefined : templateListWords.takenOver}
        cards={packaged.map(({ pack, entry }) => ({
          key: entry.key,
          title: entry.definition.title,
          sub: pack.title,
          right: String(entry.definition.sections.flatMap((section) => section.fields).length),
          ...(keeps
            ? {
                actions: (
                  <TakeOver
                    entryKey={entry.key}
                    onTake={(key) => {
                      void navigate({ to: templatePlaces.new, search: { [takenFromWord]: key } })
                    }}
                  />
                ),
              }
            : {}),
        }))}
        cardsEmpty={
          catalogue === null
            ? (absence ?? catalogueAbsenceWords.notYet)
            : templateListWords.noPackaged
        }
      >
        <thead>
          <tr>
            <Column>Vorlage</Column>
            <Column className="w-[170px]">Paket</Column>
            <Column numeric className="w-[80px]">
              Punkte
            </Column>
            {keeps ? <Column className="w-[230px]">{''}</Column> : null}
          </tr>
        </thead>
        <tbody>
          {packaged.length === 0 ? (
            <tr>
              <Cell colSpan={keeps ? 4 : 3}>
                {catalogue === null
                  ? (absence ?? catalogueAbsenceWords.notYet)
                  : templateListWords.noPackaged}
              </Cell>
            </tr>
          ) : (
            packaged.map(({ pack, entry }) => (
              <tr key={entry.key}>
                <Cell>
                  <div className="flex flex-col items-start gap-1 leading-[1.32]">
                    <span className="font-medium">{entry.definition.title}</span>
                    <span className="flex flex-wrap gap-1.5 text-[12px] text-ink-faint">
                      Fassung {String(entry.version)}
                      <ReviewMarks review={entry.review} />
                    </span>
                  </div>
                </Cell>
                <Cell>{pack.title}</Cell>
                <Cell numeric>
                  {String(entry.definition.sections.flatMap((section) => section.fields).length)}
                </Cell>
                {keeps ? (
                  <Cell className="text-right">
                    <TakeOver
                      entryKey={entry.key}
                      onTake={(key) => {
                        void navigate({ to: templatePlaces.new, search: { [takenFromWord]: key } })
                      }}
                    />
                  </Cell>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </TablePanel>
    </Screen>
  )
}

function TakeOver({
  entryKey,
  onTake,
}: {
  readonly entryKey: string
  readonly onTake: (key: string) => void
}) {
  return (
    <Button
      size="small"
      icon={Copy}
      onClick={() => {
        onTake(entryKey)
      }}
    >
      {templateListWords.takeOver}
    </Button>
  )
}
