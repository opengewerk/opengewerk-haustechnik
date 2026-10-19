import {
  contactLimits,
  type ContactTextField,
  contactTextFields,
  type Contractor,
  contractorLimits,
  type ContractorName,
  contractorProblems,
  contractorServices,
  costGroupWords,
  operatorContacts,
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
import { Check, Plus } from 'lucide-react'
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
  contacts: 'Ansprechpartner',
  contactsOpen: 'einklappen',
  contactsClosed: 'aufklappen',
  anotherContact: 'Weiteren hinzufügen',
  firstContact: 'Ansprechpartner hinzufügen',
  removeContact: 'Entfernen',
  contactsHint:
    'Ein leerer Ansprechpartner wird nicht angelegt. Firma und Ansprechpartner entstehen zusammen; später pflegen Sie sie auf der Seite der Firma.',
} as const

/** One person to talk to as the dialog holds it, before anything is sent (#383). */
type ContactDraft = Readonly<Record<ContactTextField, string>> & { readonly key: number }

const emptyContact = (key: number): ContactDraft => ({
  key,
  givenName: '',
  familyName: '',
  role: '',
  phone: '',
  mobile: '',
  email: '',
})

/** Whether a person of the dialog says anything; one that says nothing is no contact. */
function saysSomething(person: ContactDraft): boolean {
  return contactTextFields.some((field) => person[field].trim() !== '')
}

/** A person as the route takes it: every text trimmed, an empty one none. */
function contactOf(person: ContactDraft): Readonly<Record<ContactTextField, string | null>> {
  return Object.fromEntries(
    contactTextFields.map((field) => [
      field,
      person[field].trim() === '' ? null : person[field].trim(),
    ]),
  ) as Record<ContactTextField, string | null>
}

const contactLabels: Readonly<Record<ContactTextField, string>> = {
  givenName: 'Vorname',
  familyName: 'Nachname',
  role: 'Funktion',
  phone: 'Telefon',
  mobile: 'Mobil',
  email: 'E-Mail',
}

/**
 * The people to talk to in the dialog that makes a firm (#383, the board
 * "Fremdfirma anlegen, mit Ansprechpartner"): folded away until somebody
 * opens it, then one person and as many more as wanted, each with the fields
 * of a contact on the page of the firm.
 */
function ContactsSection({
  people,
  problems,
  onChange,
}: {
  readonly people: readonly ContactDraft[]
  readonly problems: Readonly<Record<number, string>>
  readonly onChange: (people: readonly ContactDraft[]) => void
}) {
  const [open, setOpen] = useState(people.length > 0)
  const next = () => Math.max(0, ...people.map((person) => person.key)) + 1
  const filled = people.filter(saysSomething).length

  return (
    <section className="flex flex-col gap-2" aria-label={contractorDialogWords.contacts}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-ink"
        onClick={() => {
          setOpen((was) => {
            if (!was && people.length === 0) {
              onChange([emptyContact(1)])
            }

            return !was
          })
        }}
      >
        <span className="text-[13px] font-semibold">{contractorDialogWords.contacts}</span>
        {filled > 0 ? <span className="text-[12px] text-ink-faint">{filled}</span> : null}
        <span className="grow" />
        <span className="text-[12px] text-ink-muted">
          {open ? contractorDialogWords.contactsOpen : contractorDialogWords.contactsClosed}
        </span>
      </button>
      {open ? (
        <>
          {people.map((person, index) => (
            <fieldset
              key={person.key}
              className="flex flex-col gap-2.5 rounded-[6px] border border-line bg-surface-sunken p-3"
            >
              <legend className="sr-only">{`${contractorDialogWords.contacts} ${String(index + 1)}`}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['givenName', 'familyName'] as const).map((field) => (
                  <Field
                    key={field}
                    label={contactLabels[field]}
                    {...(field === 'familyName' ? { required: true, starred: true } : {})}
                    value={person[field]}
                    maxLength={contactLimits[field]}
                    {...(field === 'familyName' && problems[person.key] !== undefined
                      ? { problem: problems[person.key] }
                      : {})}
                    onChange={(event) => {
                      onChange(
                        people.map((each) =>
                          each.key === person.key ? { ...each, [field]: event.target.value } : each,
                        ),
                      )
                    }}
                  />
                ))}
              </div>
              <Field
                label={contactLabels.role}
                value={person.role}
                maxLength={contactLimits.role}
                onChange={(event) => {
                  onChange(
                    people.map((each) =>
                      each.key === person.key ? { ...each, role: event.target.value } : each,
                    ),
                  )
                }}
              />
              {/* Both numbers side by side, the address under them (#428). */}
              <div className="grid gap-3 sm:grid-cols-2">
                {(['phone', 'mobile'] as const).map((field) => (
                  <Field
                    key={field}
                    label={contactLabels[field]}
                    type="tel"
                    value={person[field]}
                    maxLength={contactLimits[field]}
                    onChange={(event) => {
                      onChange(
                        people.map((each) =>
                          each.key === person.key ? { ...each, [field]: event.target.value } : each,
                        ),
                      )
                    }}
                  />
                ))}
              </div>
              <Field
                label={contactLabels.email}
                type="email"
                value={person.email}
                maxLength={contactLimits.email}
                onChange={(event) => {
                  onChange(
                    people.map((each) =>
                      each.key === person.key ? { ...each, email: event.target.value } : each,
                    ),
                  )
                }}
              />
              <div className="flex justify-end">
                <Button
                  size="small"
                  aria-label={`${contractorDialogWords.contacts} ${String(index + 1)} entfernen`}
                  onClick={() => {
                    onChange(people.filter((each) => each.key !== person.key))
                  }}
                >
                  {contractorDialogWords.removeContact}
                </Button>
              </div>
            </fieldset>
          ))}
          <div className="flex">
            <Button
              size="small"
              icon={Plus}
              disabled={people.length >= contractorLimits.contacts}
              onClick={() => {
                onChange([...people, emptyContact(next())])
              }}
            >
              {people.length === 0
                ? contractorDialogWords.firstContact
                : contractorDialogWords.anotherContact}
            </Button>
          </div>
          <p className="text-[12px] text-ink-faint">{contractorDialogWords.contactsHint}</p>
        </>
      ) : null}
    </section>
  )
}

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
  // The people a new firm is made with (#383); a firm that is there keeps them on its page.
  const [people, setPeople] = useState<readonly ContactDraft[]>([])
  const [peopleProblems, setPeopleProblems] = useState<Readonly<Record<number, string>>>({})
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
    const said = people.filter(saysSomething)
    const missing = Object.fromEntries(
      said.flatMap((person) => {
        const problem = operatorContacts.personProblems(contactOf(person))['familyName']

        return problem === undefined ? [] : [[person.key, problem] as const]
      }),
    )

    setProblems(found)
    setPeopleProblems(missing)

    if (Object.keys(found).length > 0 || Object.keys(missing).length > 0) {
      return
    }

    void ask(() =>
      contractor === undefined
        ? makeAt(client, '/contractors', {
            ...values,
            ...(said.length === 0 ? {} : { contacts: said.map(contactOf) }),
          })
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
        {contractor === undefined ? (
          <ContactsSection people={people} problems={peopleProblems} onChange={setPeople} />
        ) : null}
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
