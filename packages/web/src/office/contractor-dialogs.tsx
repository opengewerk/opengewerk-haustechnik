import {
  type Contractor,
  contractorLimits,
  type ContractorName,
  contractorProblems,
  contractorServices,
  costGroupWords,
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
import { type EditResult, refusalFor, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { useCatalogue } from '../sync/catalogue.js'
import { askAt, makeAt } from '../sync/made-at.js'
import { contractorKey, contractorListQuery } from './contractor-addresses.js'

/**
 * The dialogs of the contractors (#328, the boards "Fremdfirma anlegen" and
 * "Namen an Pflichten als Fremdfirmen übernehmen"): a firm with its address,
 * the cost groups it works in and a note, and the names that stand as text
 * at duties, each taken over as a new firm or matched to one of the list.
 */

export const contractorDialogWords = {
  servicesHint:
    'Die Kostengruppen, in denen die Firma arbeitet. Sie filtern die Liste und die Auswahl an einer Pflicht.',
  takeoverLead:
    'Jeder gewählte Name wird eine Fremdfirma, oder er wird einer zugeordnet, die schon in der Liste steht. Die Pflichten nennen sie danach aus der Liste. Anschrift, Ansprechpartner und Leistungen tragen Sie an der Firma nach.',
  takeoverKeeps: 'Nachweise behalten ihre Organisation, wie sie geschrieben wurde.',
  asNew: 'Als neue Fremdfirma',
  noneChosen: 'Wählen Sie mindestens einen Namen.',
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

      await queries.invalidateQueries({ queryKey: contractorKey })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return { working, trouble, setTrouble, ask }
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

/** "KG 440 Elektrische Anlage", in the words of the catalogue on the device, or the number alone. */
export function useServiceWords(): (service: string) => string {
  const catalogue = useCatalogue()
  const kinds = useMemo(() => catalogue?.assetKinds(today()) ?? [], [catalogue])

  return (service) => costGroupWords(service, kinds)
}

/** "Fremdfirma anlegen" and the same form to change a firm: name, address, services and note. */
export function ContractorDialog({
  contractor,
  onClose,
}: {
  readonly contractor?: Contractor
  readonly onClose: () => void
}) {
  const client = useSync()
  const words = useServiceWords()
  const { working, trouble, ask } = useAsking(onClose)
  const [name, setName] = useState(contractor?.name ?? '')
  const [street, setStreet] = useState(contractor?.street ?? '')
  const [postalCode, setPostalCode] = useState(contractor?.postalCode ?? '')
  const [city, setCity] = useState(contractor?.city ?? '')
  const [phone, setPhone] = useState(contractor?.phone ?? '')
  const [email, setEmail] = useState(contractor?.email ?? '')
  const [services, setServices] = useState<readonly string[]>(contractor?.services ?? [])
  const [note, setNote] = useState(contractor?.note ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim())
  const problemOf = (field: string) =>
    problems[field] === undefined ? {} : { problem: problems[field] }

  function send() {
    const values = {
      name: name.trim(),
      street: orNull(street),
      postalCode: orNull(postalCode),
      city: orNull(city),
      phone: orNull(phone),
      email: orNull(email),
      services: contractorServices.filter((service) => services.includes(service)),
      note: orNull(note),
    }
    const found = contractorProblems(values)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void ask(() =>
      contractor === undefined
        ? makeAt(client, '/contractors', values)
        : askAt(
            client,
            'PATCH',
            `/contractors/${encodeURIComponent(contractor.id)}`,
            contractor.id,
            values,
          ),
    )
  }

  return (
    <Dialog
      title={contractor === undefined ? 'Fremdfirma anlegen' : `${contractor.name} ändern`}
      width={640}
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
          label="Name"
          required
          starred
          value={name}
          maxLength={contractorLimits.name}
          {...problemOf('name')}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <Field
          label="Straße"
          value={street}
          maxLength={contractorLimits.street}
          {...problemOf('street')}
          onChange={(event) => {
            setStreet(event.target.value)
          }}
        />
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <Field
            label="PLZ"
            value={postalCode}
            maxLength={contractorLimits.postalCode}
            {...problemOf('postalCode')}
            onChange={(event) => {
              setPostalCode(event.target.value)
            }}
          />
          <Field
            label="Ort"
            value={city}
            maxLength={contractorLimits.city}
            {...problemOf('city')}
            onChange={(event) => {
              setCity(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Telefon"
            type="tel"
            value={phone}
            maxLength={contractorLimits.phone}
            {...problemOf('phone')}
            onChange={(event) => {
              setPhone(event.target.value)
            }}
          />
          <Field
            label="E-Mail"
            type="email"
            value={email}
            maxLength={contractorLimits.email}
            {...problemOf('email')}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
          />
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">Leistungen</legend>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {contractorServices.map((service) => (
              <label
                key={service}
                className="inline-flex min-h-6 items-start gap-2 text-[13px] leading-[1.35] max-lg:min-h-tap"
              >
                <input
                  type="checkbox"
                  className="mt-[1px] size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
                  checked={services.includes(service)}
                  onChange={(event) => {
                    const on = event.target.checked

                    setServices((held) =>
                      on ? [...held, service] : held.filter((each) => each !== service),
                    )
                  }}
                />
                <span>
                  <b className="font-semibold">{`KG ${service}`}</b>
                  {words(service).slice(`KG ${service}`.length)}
                </span>
              </label>
            ))}
          </div>
          <p className="text-[12px] text-ink-faint">{contractorDialogWords.servicesHint}</p>
          {problems['services'] === undefined ? null : (
            <p className="text-[13px] font-semibold text-conflict">{problems['services']}</p>
          )}
        </fieldset>
        <TextArea
          label="Notiz"
          rows={2}
          value={note}
          maxLength={contractorLimits.note}
          {...problemOf('note')}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={contractor === undefined ? 'Anlegen' : 'Speichern'}
        />
      </form>
    </Dialog>
  )
}

/**
 * "Namen übernehmen" (decided 15.10.2026): the names that stand as text at
 * open duties, each chosen or not, and for each whether it becomes a new
 * firm or one of the list. The server finds the firm with the same name.
 */
export function TakeoverDialog({
  names,
  onClose,
}: {
  readonly names: readonly ContractorName[]
  readonly onClose: () => void
}) {
  const client = useSync()
  const firms = useQuery(contractorListQuery).data ?? []
  const { working, trouble, setTrouble, ask } = useAsking(onClose)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(names.map((each) => each.name)),
  )
  const [targets, setTargets] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(names.map((each) => [each.name, each.contractorId ?? ''])),
  )
  const picked = names.filter((each) => chosen.has(each.name))

  function send() {
    if (picked.length === 0) {
      setTrouble(contractorDialogWords.noneChosen)

      return
    }

    void ask(() =>
      askAt(client, 'POST', '/contractors/takeover', 'takeover', {
        items: picked.map((each) => ({
          name: each.name,
          contractorId: (targets[each.name] ?? '') === '' ? null : targets[each.name],
        })),
      }),
    )
  }

  return (
    <Dialog title="Namen als Fremdfirmen übernehmen" width={640} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <p className="text-[13px]">{contractorDialogWords.takeoverLead}</p>
        <ul className="flex flex-col divide-y divide-row rounded-control border border-line">
          {names.map((each) => (
            <li
              key={each.name}
              className="grid items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_200px]"
            >
              <label className="inline-flex min-h-6 items-start gap-2 text-[14px] max-lg:min-h-tap">
                <input
                  type="checkbox"
                  className="mt-[3px] size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
                  checked={chosen.has(each.name)}
                  onChange={(event) => {
                    const on = event.target.checked

                    setChosen((held) => {
                      const next = new Set(held)

                      if (on) {
                        next.add(each.name)
                      } else {
                        next.delete(each.name)
                      }

                      return next
                    })
                  }}
                />
                <span className="[overflow-wrap:anywhere]">
                  {each.name}
                  <span className="block text-[12px] text-ink-faint">
                    {each.duties === 1 ? '1 Pflicht' : `${String(each.duties)} Pflichten`}
                  </span>
                </span>
              </label>
              <SelectField
                label={`Wird zu, für ${each.name}`}
                value={targets[each.name] ?? ''}
                options={[
                  { value: '', label: contractorDialogWords.asNew },
                  ...firms.map((firm) => ({ value: firm.id, label: firm.name })),
                ]}
                onChange={(value) => {
                  setTargets((held) => ({ ...held, [each.name]: value }))
                }}
              />
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-ink-faint">{contractorDialogWords.takeoverKeeps}</p>
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={`${String(picked.length)} übernehmen`}
        />
      </form>
    </Dialog>
  )
}
