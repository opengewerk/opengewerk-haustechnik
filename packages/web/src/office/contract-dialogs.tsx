import {
  byNameIn,
  type Contract,
  contractLimits,
  contractProblems,
  contractTermProblems,
  type NoticeUnit,
  type RecordState,
  noticeUnitLabel,
  noticeUnits,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  SelectField,
  TextArea,
} from '@opengewerk/platform-web'
import {
  type EditResult,
  maybeText,
  refusalFor,
  text,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { askAt, makeAt } from '../sync/made-at.js'
import { contractKey, firmContractsQuery } from './contract-addresses.js'
import { ContractorField } from './contractor-field.js'

/**
 * The dialogs of the contracts (#329, the boards "Vertrag anlegen", "Vertrag
 * bearbeiten" and "Gebäude oder Anlage erfassen"): a contract with its firm,
 * its term with how it renews and the notice it takes, and what it says about
 * the response time and the price; and covering a building or an asset.
 */

export const contractDialogWords = {
  intro:
    'Was der Vertrag erfasst und welche Pflichten er erfüllt, wählen Sie danach auf seiner Seite und an der Pflicht.',
  endsHint: 'Leer, wenn er unbefristet ist.',
  renewalHint: 'Monate, wenn nicht gekündigt. Leer: endet.',
  cancelledHint: 'Der Vertrag endet an diesem Tag und verlängert sich nicht mehr.',
  priceHint: 'Als Angabe, die Anwendung rechnet nicht damit.',
  coverHint: 'Ein Gebäude oder eine Anlage. Ein Gebäude erfasst alle seine Anlagen.',
  coverDuties: 'Welche Pflichten der Vertrag erfüllt, wählen Sie an der Pflicht.',
  choose: 'Bitte wählen',
  chooseCover: 'Wählen Sie ein Gebäude oder eine Anlage.',
  noContract: 'Ohne Vertrag',
  contractHint: 'Ein Vertrag der Firma, den die Pflicht erfüllt. Leer: ohne Vertrag.',
  noContractList: 'Die Verträge kommen vom Server, mit Verbindung.',
  removedContract: 'Ein entfernter Vertrag',
} as const

function useAsking(onDone: () => void) {
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function ask(question: () => Promise<EditResult>) {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await question()

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: contractKey })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return { working, trouble, ask }
}

function Trouble({ children }: { readonly children: ReactNode }) {
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

/** A whole number a field holds, null where it is empty, and the text itself where it is no number. */
function wholeOrText(value: string): number | string | null {
  const trimmed = value.trim()

  return trimmed === '' ? null : /^\d+$/u.test(trimmed) ? Number(trimmed) : trimmed
}

/** "Vertrag anlegen" and the same form to change a contract, with the notice given. */
export function ContractDialog({
  contract,
  onClose,
}: {
  readonly contract?: Contract
  readonly onClose: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)
  const [title, setTitle] = useState(contract?.title ?? '')
  const [contractorId, setContractorId] = useState<string>(contract?.contractorId ?? '')
  const [startsOn, setStartsOn] = useState(contract?.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(contract?.endsOn ?? '')
  const [renewal, setRenewal] = useState(
    contract?.renewalMonths === null || contract === undefined
      ? ''
      : String(contract.renewalMonths),
  )
  const [notice, setNotice] = useState(
    contract?.noticeAmount === null || contract === undefined ? '' : String(contract.noticeAmount),
  )
  const [unit, setUnit] = useState<NoticeUnit>(contract?.noticeUnit ?? 'months')
  const [cancelledTo, setCancelledTo] = useState(contract?.cancelledTo ?? '')
  const [responseTime, setResponseTime] = useState(contract?.responseTime ?? '')
  const [price, setPrice] = useState(contract?.price ?? '')
  const [note, setNote] = useState(contract?.note ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim())
  const problemOf = (field: string) =>
    problems[field] === undefined ? {} : { problem: problems[field] }

  function send() {
    const noticeAmount = wholeOrText(notice)
    const values = {
      title: title.trim(),
      contractorId,
      startsOn: startsOn.trim(),
      endsOn: orNull(endsOn),
      renewalMonths: wholeOrText(renewal),
      noticeAmount,
      noticeUnit: noticeAmount === null ? null : unit,
      cancelledTo: orNull(cancelledTo),
      responseTime: orNull(responseTime),
      price: orNull(price),
      note: orNull(note),
    }
    const found: Record<string, string> = {
      ...(contractorId === '' ? { contractorId: 'Wählen Sie die Fremdfirma.' } : {}),
      ...contractProblems(values),
    }

    if (Object.keys(found).length === 0) {
      Object.assign(
        found,
        contractTermProblems(values as Parameters<typeof contractTermProblems>[0]),
      )
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void ask(() =>
      contract === undefined
        ? makeAt(client, '/contracts', values)
        : askAt(
            client,
            'PATCH',
            `/contracts/${encodeURIComponent(contract.id)}`,
            contract.id,
            values,
          ),
    )
  }

  return (
    <Dialog
      title={contract === undefined ? 'Vertrag anlegen' : `${contract.title} bearbeiten`}
      width={640}
      onClose={onClose}
      {...(contract === undefined ? { sub: contractDialogWords.intro } : {})}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
          <Field
            label="Bezeichnung"
            required
            starred
            value={title}
            maxLength={contractLimits.title}
            {...problemOf('title')}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
          />
          <ContractorField
            value={contractorId}
            hint=""
            {...problemOf('contractorId')}
            onChange={setContractorId}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Beginn"
            type="date"
            required
            starred
            value={startsOn}
            {...problemOf('startsOn')}
            onChange={(event) => {
              setStartsOn(event.target.value)
            }}
          />
          <Field
            label="Ende der Laufzeit"
            type="date"
            value={endsOn}
            hint={contractDialogWords.endsHint}
            {...problemOf('endsOn')}
            onChange={(event) => {
              setEndsOn(event.target.value)
            }}
          />
          <Field
            label="Verlängert sich um"
            type="number"
            inputMode="numeric"
            min={1}
            max={contractLimits.renewalMonths}
            value={renewal}
            hint={contractDialogWords.renewalHint}
            {...problemOf('renewalMonths')}
            onChange={(event) => {
              setRenewal(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[110px_150px_minmax(0,1fr)]">
          <Field
            label="Kündigungsfrist"
            type="number"
            inputMode="numeric"
            min={1}
            max={contractLimits.noticeAmount}
            value={notice}
            {...problemOf('noticeAmount')}
            onChange={(event) => {
              setNotice(event.target.value)
            }}
          />
          <SelectField
            label="Einheit"
            value={unit}
            options={noticeUnits.map((each) => ({ value: each, label: noticeUnitLabel[each] }))}
            onChange={(chosen) => {
              setUnit(chosen as NoticeUnit)
            }}
          />
          <Field
            label="Gekündigt zum"
            type="date"
            value={cancelledTo}
            hint={contractDialogWords.cancelledHint}
            {...problemOf('cancelledTo')}
            onChange={(event) => {
              setCancelledTo(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Reaktionszeit"
            value={responseTime}
            maxLength={contractLimits.responseTime}
            {...problemOf('responseTime')}
            onChange={(event) => {
              setResponseTime(event.target.value)
            }}
          />
          <Field
            label="Preis"
            value={price}
            maxLength={contractLimits.price}
            hint={contractDialogWords.priceHint}
            {...problemOf('price')}
            onChange={(event) => {
              setPrice(event.target.value)
            }}
          />
        </div>
        <TextArea
          label="Notiz"
          rows={2}
          value={note}
          maxLength={contractLimits.note}
          {...problemOf('note')}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={contract === undefined ? 'Anlegen' : 'Speichern'}
        />
      </form>
    </Dialog>
  )
}

/**
 * The buildings and the assets the device holds, each as the field "Woran"
 * of a task names it, the buildings first: what a contract can cover.
 */
function useCoverChoices(): readonly { value: string; label: string }[] {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const assets = useRecords('assets')

  return useMemo(() => {
    const property = new Map(properties.map((each) => [String(each['id']), each]))
    const building = new Map(buildings.map((each) => [String(each['id']), each]))
    const name = (record: RecordState | undefined) => maybeText(record ?? null, 'name') ?? ''
    const byLabel = (left: { label: string }, right: { label: string }) =>
      byNameIn(left.label, right.label)

    return [
      ...buildings
        .map((each) => ({
          value: `buildingId:${String(each['id'])}`,
          label: `Gebäude ${name(each)}, ${name(property.get(text(each, 'propertyId')))}`,
        }))
        .sort(byLabel),
      ...assets
        .map((each) => ({
          value: `assetId:${String(each['id'])}`,
          label: [
            [maybeText(each, 'number'), name(each)].filter(Boolean).join(' '),
            name(building.get(text(each, 'buildingId'))),
          ]
            .filter(Boolean)
            .join(', '),
        }))
        .sort(byLabel),
    ]
  }, [properties, buildings, assets])
}

/** "Gebäude oder Anlage erfassen": one choice over the buildings and the assets the person sees. */
export function CoverDialog({
  contractId,
  onClose,
}: {
  readonly contractId: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)
  const choices = useCoverChoices()
  const [chosen, setChosen] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  function send() {
    const [field, id] = chosen.split(':')

    if ((field !== 'buildingId' && field !== 'assetId') || id === undefined) {
      setProblem(contractDialogWords.chooseCover)

      return
    }

    void ask(() =>
      askAt(client, 'POST', `/contracts/${encodeURIComponent(contractId)}/items`, contractId, {
        [field]: id,
      }),
    )
  }

  return (
    <Dialog title="Gebäude oder Anlage erfassen" width={520} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <SelectField
          label="Woran"
          required
          starred
          value={chosen}
          options={[{ value: '', label: contractDialogWords.choose }, ...choices]}
          hint={contractDialogWords.coverHint}
          {...(problem === null ? {} : { problem })}
          onChange={setChosen}
        />
        <p className="text-[12px] text-ink-faint">{contractDialogWords.coverDuties}</p>
        <Trouble>{trouble}</Trouble>
        <Actions working={working} onClose={onClose} label="Erfassen" />
      </form>
    </Dialog>
  )
}

/**
 * "Vertrag" at a duty (#329): a live contract of the firm the duty names, or
 * none. Without a firm there is nothing to choose; a contract removed since
 * it was chosen stays chosen, under words that say so.
 */
export function ContractField({
  contractorId,
  value,
  onChange,
}: {
  readonly contractorId: string
  readonly value: string
  readonly onChange: (contractId: string) => void
}) {
  const contracts = useQuery({ ...firmContractsQuery(contractorId), enabled: contractorId !== '' })
  const live = contracts.data ?? []
  const gone =
    value !== '' && contracts.data !== undefined && !live.some((each) => each.id === value)

  return (
    <SelectField
      label="Vertrag"
      value={value}
      disabled={contractorId === ''}
      options={[
        { value: '', label: contractDialogWords.noContract },
        ...(gone ? [{ value, label: contractDialogWords.removedContract }] : []),
        ...live.map((each) => ({ value: each.id, label: each.title })),
      ]}
      hint={
        contracts.isError ? contractDialogWords.noContractList : contractDialogWords.contractHint
      }
      onChange={onChange}
    />
  )
}
