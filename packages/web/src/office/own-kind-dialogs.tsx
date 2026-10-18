import {
  costGroupWords,
  type DocumentKind,
  documentKindLabel,
  documentKinds,
  type ExpectedDemand,
  expectedDemandLabel,
  expectedDocumentsProblem,
  isOwnKind,
  type OwnFieldSort,
  ownFieldProblems,
  ownFieldSortLabel,
  ownFieldSorts,
  ownKindLimits,
  ownKindProblems,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  SelectField,
  TextArea,
} from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { kindChoices } from '../app/asset-values.js'
import { catalogueChecksumQuery, useCatalogue } from '../sync/catalogue.js'
import {
  type OwnFieldView,
  ownKindRoutes,
  ownKindsKey,
  type OwnKindView,
} from './own-kind-addresses.js'
import { Segmented } from './segmented.js'

/**
 * The dialogs of the asset kinds and fields of the operator's own (#62, the
 * boards "Eigene Anlagenart anlegen" and "Eigene Angabe an einer Anlagenart
 * ergänzen"): a kind with its label and cost group, a field at a kind with
 * its sort, and a document a kind expects. Each asks its route with a
 * connection and has the device fetch the catalogue again, which holds them.
 */

export const ownKindWords = {
  makeKind: 'Anlagenart anlegen',
  addField: 'Angabe ergänzen',
  addDocument: 'Unterlage ergänzen',
  costGroupHint: 'Nach ihr ordnen Anlagenverzeichnis und Lagebild die Anlagen dieser Art.',
  afterwards: 'Angaben und Unterlagen kommen auf der Seite der Anlagenart dazu.',
  sortStays: 'Die Sorte bleibt, sobald eine Anlage einen Wert dieser Angabe trägt.',
  optionsHint: 'Eine Möglichkeit je Zeile.',
  sourceHint: 'Wo die Unterlage verlangt ist: Paragraf oder Norm mit Ausgabe und Abschnitt.',
  noConnection: 'Ohne Verbindung. Eigene Anlagenarten und Angaben ändern sich mit dem Server.',
} as const

/**
 * Asks a route, with a connection, and then the catalogue again: a kind or a
 * field of the operator's own is part of it, and the next screen should show
 * it. A refusal says its sentence.
 */
export function useOwnKindRoute(onDone: () => void) {
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function run<Answer>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Answer | undefined> {
    setWorking(true)
    setTrouble(null)

    try {
      const answer = await request<Answer>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

      await Promise.all([
        queries.invalidateQueries({ queryKey: ownKindsKey }),
        queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey }),
      ])
      onDone()

      return answer
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : ownKindWords.noConnection)

      return undefined
    } finally {
      setWorking(false)
    }
  }

  return { working, trouble, run }
}

export function Trouble({ children }: { readonly children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

function Actions({
  working,
  onClose,
  label,
}: {
  readonly working: boolean
  readonly onClose: () => void
  readonly label: string
}) {
  return (
    <DialogActions>
      <Button type="button" disabled={working} onClick={onClose}>
        Abbrechen
      </Button>
      <Button type="submit" tone="primary" icon={Check} disabled={working}>
        {working ? 'Einen Moment' : label}
      </Button>
    </DialogActions>
  )
}

/** The cost groups the kinds of the packages name, each in the words of the catalogue. */
function useCostGroups(): readonly { readonly value: string; readonly label: string }[] {
  const catalogue = useCatalogue()

  return useMemo(() => {
    const kinds = (catalogue?.assetKinds(today()) ?? []).filter((kind) => !isOwnKind(kind.key))

    return [...new Set(kinds.map((kind) => kind.definition.costGroup))]
      .sort()
      .map((group) => ({ value: group, label: costGroupWords(group, kinds) }))
  }, [catalogue])
}

/** "Anlagenart anlegen", and the same to change what a kind is called and its cost group. */
export function OwnKindDialog({
  kind,
  onClose,
  onMade,
}: {
  readonly kind?: OwnKindView
  readonly onClose: () => void
  readonly onMade?: (key: string) => void
}) {
  const groups = useCostGroups()
  const [label, setLabel] = useState(kind?.label ?? '')
  const [costGroup, setCostGroup] = useState(kind?.costGroup ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const { working, trouble, run } = useOwnKindRoute(onClose)

  function send() {
    const values = { label: label.trim(), costGroup }
    const found = ownKindProblems(
      values,
      groups.map((group) => group.value),
    )

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void (async () => {
      const answer =
        kind?.id === undefined || kind.id === null
          ? await run<{ key: string }>('POST', ownKindRoutes.list, values)
          : await run<{ key: string }>('PATCH', ownKindRoutes.kind(kind.id), values)

      if (answer !== undefined && kind === undefined) {
        onMade?.(answer.key)
      }
    })()
  }

  return (
    <Dialog
      title={kind === undefined ? ownKindWords.makeKind : `${kind.label} ändern`}
      width={520}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <Field
          label="Bezeichnung"
          required
          starred
          value={label}
          maxLength={ownKindLimits.label}
          placeholder="etwa Hebeanlage"
          {...(problems['label'] === undefined ? {} : { problem: problems['label'] })}
          onChange={(event) => {
            setLabel(event.target.value)
          }}
        />
        <SelectField
          label="Kostengruppe"
          required
          starred
          options={[{ value: '', label: 'Bitte wählen' }, ...groups]}
          value={costGroup}
          hint={ownKindWords.costGroupHint}
          {...(problems['costGroup'] === undefined ? {} : { problem: problems['costGroup'] })}
          onChange={setCostGroup}
        />
        {kind === undefined ? (
          <p className="text-[13px] text-ink-muted">{ownKindWords.afterwards}</p>
        ) : null}
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={kind === undefined ? 'Anlegen' : 'Speichern'}
        />
      </form>
    </Dialog>
  )
}

/**
 * "Angabe ergänzen" at a kind, or with the kind to choose among those of the
 * packages, and the same to change a field: its label, the unit of a number
 * and the choices of a choice. The sort is chosen once.
 */
export function OwnFieldDialog({
  field,
  assetKind,
  onClose,
}: {
  readonly field?: OwnFieldView
  readonly assetKind?: string
  readonly onClose: () => void
}) {
  const catalogue = useCatalogue()
  const packageKinds = useMemo(
    () =>
      catalogue === null ? [] : kindChoices(catalogue).filter((each) => !isOwnKind(each.value)),
    [catalogue],
  )
  const [kind, setKind] = useState(field?.assetKind ?? assetKind ?? '')
  const [label, setLabel] = useState(field?.label ?? '')
  const [sort, setSort] = useState<OwnFieldSort>(field?.sort ?? 'text')
  const [unit, setUnit] = useState(field?.unit ?? '')
  const [options, setOptions] = useState(
    (field?.options ?? []).map((option) => option.label).join('\n'),
  )
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const { working, trouble, run } = useOwnKindRoute(onClose)
  const problemOf = (name: string) =>
    problems[name] === undefined ? {} : { problem: problems[name] }

  function send() {
    const lines = options
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    const values = {
      label: label.trim(),
      ...(sort === 'number' ? { unit: unit.trim() === '' ? null : unit.trim() } : {}),
      ...(sort === 'choice' ? { options: lines } : {}),
    }
    const found = {
      ...ownFieldProblems({ ...values, sort }),
      ...(kind === '' ? { assetKind: 'Die Anlagenart fehlt.' } : {}),
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void (field?.id === undefined || field.id === null
      ? run('POST', ownKindRoutes.fields, { ...values, assetKind: kind, sort })
      : run('PATCH', ownKindRoutes.field(field.id), values))
  }

  return (
    <Dialog
      title={field === undefined ? ownKindWords.addField : `${field.label} ändern`}
      width={600}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {field === undefined && assetKind === undefined ? (
          <SelectField
            label="Anlagenart"
            required
            starred
            options={[{ value: '', label: 'Bitte wählen' }, ...packageKinds]}
            value={kind}
            {...problemOf('assetKind')}
            onChange={setKind}
          />
        ) : null}
        <Field
          label="Bezeichnung"
          required
          starred
          value={label}
          maxLength={ownKindLimits.label}
          placeholder="etwa Standortnummer im Plan"
          {...problemOf('label')}
          onChange={(event) => {
            setLabel(event.target.value)
          }}
        />
        {field === undefined ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">Sorte</span>
            <Segmented
              label="Sorte der Angabe"
              options={ownFieldSorts.map((each) => ownFieldSortLabel[each])}
              chosen={ownFieldSorts.indexOf(sort)}
              onChoose={(index) => {
                setSort(ownFieldSorts[index] ?? 'text')
              }}
            />
            <span className="text-[12px] text-ink-faint">{ownKindWords.sortStays}</span>
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">
            Sorte: {ownFieldSortLabel[field.sort]}. {ownKindWords.sortStays}
          </p>
        )}
        {sort === 'number' ? (
          <Field
            label="Einheit"
            value={unit}
            maxLength={ownKindLimits.unit}
            placeholder="etwa m³/h"
            {...problemOf('unit')}
            onChange={(event) => {
              setUnit(event.target.value)
            }}
          />
        ) : null}
        {sort === 'choice' ? (
          <TextArea
            label="Auswahl"
            required
            starred
            rows={4}
            value={options}
            hint={ownKindWords.optionsHint}
            {...problemOf('options')}
            onChange={(event) => {
              setOptions(event.target.value)
            }}
          />
        ) : null}
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={field === undefined ? 'Ergänzen' : 'Speichern'}
        />
      </form>
    </Dialog>
  )
}

const demands: readonly ExpectedDemand[] = ['required', 'recommended']

/** "Unterlage ergänzen" at an own kind: its label, the kind of document, required with its source or recommended. */
export function OwnDocumentDialog({
  kind,
  onClose,
}: {
  readonly kind: OwnKindView
  readonly onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [documentKind, setDocumentKind] = useState<DocumentKind | ''>('')
  const [demand, setDemand] = useState<ExpectedDemand>('recommended')
  const [source, setSource] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const { working, trouble, run } = useOwnKindRoute(onClose)

  function send() {
    const added = {
      label: label.trim(),
      kind: documentKind,
      demand,
      source: demand === 'required' ? source.trim() : null,
    }
    const documents = [...kind.documents, added]
    const found = expectedDocumentsProblem(documents)

    setProblem(found)

    if (found !== null || kind.id === null) {
      return
    }

    void run('PATCH', ownKindRoutes.kind(kind.id), { expectedDocuments: documents })
  }

  return (
    <Dialog title={ownKindWords.addDocument} width={600} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <Field
          label="Bezeichnung"
          required
          starred
          value={label}
          maxLength={ownKindLimits.label}
          placeholder="etwa Betriebsanleitung"
          onChange={(event) => {
            setLabel(event.target.value)
          }}
        />
        <SelectField
          label="Art des Dokuments"
          required
          starred
          options={[
            { value: '', label: 'Bitte wählen' },
            ...documentKinds.map((each) => ({ value: each, label: documentKindLabel[each] })),
          ]}
          value={documentKind}
          onChange={(value) => {
            setDocumentKind(value as DocumentKind | '')
          }}
        />
        <Segmented
          label="Verlangt oder empfohlen"
          options={demands.map((each) => expectedDemandLabel[each])}
          chosen={demands.indexOf(demand)}
          onChoose={(index) => {
            setDemand(demands[index] ?? 'recommended')
          }}
        />
        {demand === 'required' ? (
          <Field
            label="Fundstelle"
            required
            starred
            value={source}
            maxLength={ownKindLimits.source}
            hint={ownKindWords.sourceHint}
            onChange={(event) => {
              setSource(event.target.value)
            }}
          />
        ) : null}
        <Trouble>{problem ?? trouble}</Trouble>
        <Actions working={working} onClose={onClose} label="Ergänzen" />
      </form>
    </Dialog>
  )
}
