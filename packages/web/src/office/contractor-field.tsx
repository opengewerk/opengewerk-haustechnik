import { SelectField } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { contractorListQuery, contractorPlaces } from './contractor-addresses.js'

/**
 * The firm out of the list a duty, an activity or a report names (#328, the
 * boards "Pflicht bearbeiten" and "Bericht eintragen"): a choice of the live
 * firms of the operator. Where a duty named its contractor as text before,
 * the hint says what stood there; the office takes such names over under
 * "Fremdfirmen".
 */
export const contractorFieldWords = {
  label: 'Fremdfirma',
  choose: 'Bitte wählen',
  none: 'Keine aus der Liste',
  hint: 'Aus der Liste der Fremdfirmen.',
  asText: (note: string) => `Bisher als Text: „${note}“. Wählen Sie die Firma aus der Liste.`,
  removed: 'Eine entfernte Fremdfirma',
  noList: 'Die Liste der Fremdfirmen kommt vom Server, mit Verbindung.',
} as const

/** The live firms of the operator by their id, for a form and for a page that names one. */
export function useContractorNames(): ReadonlyMap<string, string> {
  const reads = useRight('contractor.read')
  const firms = useQuery({ ...contractorListQuery, enabled: reads }).data ?? []

  return new Map(firms.map((firm) => [firm.id, firm.name]))
}

export function ContractorField({
  value,
  note = null,
  noneLabel = contractorFieldWords.choose,
  hint,
  problem,
  onChange,
}: {
  /** The id of the firm chosen, or empty. */
  readonly value: string
  /** What stood as text before the list, which the hint names. */
  readonly note?: string | null
  /** What the empty choice says: "Bitte wählen", or "Keine aus der Liste" where the field may stay empty. */
  readonly noneLabel?: string
  readonly hint?: string
  readonly problem?: string | undefined
  readonly onChange: (contractorId: string) => void
}) {
  const reads = useRight('contractor.read')
  const firms = useQuery({ ...contractorListQuery, enabled: reads })
  const live = firms.data ?? []
  // A firm removed since it was chosen stays chosen, under words that say so.
  const gone = value !== '' && firms.data !== undefined && !live.some((firm) => firm.id === value)

  return (
    <SelectField
      label={contractorFieldWords.label}
      value={value}
      options={[
        { value: '', label: noneLabel },
        ...(gone ? [{ value, label: contractorFieldWords.removed }] : []),
        ...live.map((firm) => ({ value: firm.id, label: firm.name })),
      ]}
      hint={
        firms.isError
          ? contractorFieldWords.noList
          : (hint ??
            (note !== null && note !== '' && value === ''
              ? contractorFieldWords.asText(note)
              : contractorFieldWords.hint))
      }
      {...(problem === undefined ? {} : { problem })}
      onChange={onChange}
    />
  )
}

/** The firm a page names, as a link to its page, or the text that stood there before the list. */
export function ContractorName({
  contractorId,
  note,
}: {
  readonly contractorId: string | null
  readonly note: string | null
}) {
  const names = useContractorNames()

  if (contractorId === null) {
    return <>{note ?? ''}</>
  }

  return (
    <Link to={contractorPlaces.contractor(contractorId)}>
      {names.get(contractorId) ?? note ?? contractorFieldWords.removed}
    </Link>
  )
}
