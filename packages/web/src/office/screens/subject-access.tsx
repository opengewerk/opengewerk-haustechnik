import {
  type SubjectAccessChoice,
  type SubjectAccessMatch,
  subjectAccessNeedsEveryArea,
  subjectAccessTermProblem,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Choice,
  Column,
  Field,
  Panel,
  SelectField,
  TablePanel,
} from '@opengewerk/platform-web'
import { SettingsText } from '@opengewerk/platform-web/office'
import { request, RequestRefused, requestFile } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Download, Search } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { fetchPdf, savePdf } from '../../app/prints.js'

/** What the card of the information about a person says (#355, the boards "HT-Einst-Auskunft" and "HT-Einst-Auskunft-Suche"). */
export const subjectAccessWords = {
  title: 'Auskunft über eine Person',
  intro:
    'Alles, was diese Anwendung über eine Person hält, aus jedem Bereich, als Datei: zum Lesen als PDF und maschinenlesbar als JSON. Ob die anfragende Person die ist, um die es geht, prüfen Sie vorher selbst.',
  who: 'Um wen es geht',
  withAccess: 'Person mit Zugang',
  withAccessNote: 'Beschäftigte, Prüfer von außen, Melder mit Konto',
  withoutAccess: 'Person ohne Zugang',
  withoutAccessNote:
    'Melder über das Etikett, Auftraggeber, Ansprechpartner, Personen einer Fremdfirma',
  access: 'Zugang',
  term: 'Name oder E-Mail-Adresse',
  search: 'Suchen',
  found: (count: number, term: string) => `${String(count)} Treffer für „${term}“`,
  foundNote:
    'Die Auskunft enthält alles, was zu diesen Treffern gehört. Was nicht zu der Person gehört, nehmen Sie vorher aus der Suche, indem Sie genauer suchen.',
  nothing: (term: string) => `Zu „${term}“ hält die Anwendung nichts.`,
  where: 'Wo',
  name: 'Name',
  email: 'E-Mail-Adresse',
  pdf: 'PDF herunterladen',
  json: 'JSON herunterladen',
  jsonNote: 'JSON ist maschinenlesbar, zum Mitnehmen in eine andere Anwendung.',
  what: 'Nachweise nennt die Auskunft mit Nummer, Tag, Pflicht, Ort, dem, was die Person getan hat, und ihrem Schriftzug; Antworten und Messwerte gehören zur Anlage. Über andere Personen steht nichts darin. Die Auskunft wird nicht aufbewahrt.',
  loading: 'Wird geladen.',
  failed: 'Die Auskunft ließ sich nicht vorbereiten. Sie kommt vom Server, mit Verbindung.',
  offline: 'Ohne Verbindung zum Server gibt es keine Auskunft.',
} as const

const choiceKey = ['settings', 'subject-access'] as const

/** The address with the format beside what it already asks. */
function withFormat(address: string, format: 'pdf' | 'json'): string {
  return `${address}${address.includes('?') ? '&' : '?'}format=${format}`
}

/** Hands a file to the browser to save, under the name the server gave it. */
function save(content: Blob, name: string): void {
  const address = URL.createObjectURL(content)
  const link = document.createElement('a')

  link.href = address
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(address)
  }, 0)
}

/** "Als PDF" and "Als JSON" for one information, with what went wrong under them. */
function Downloads({ address, name }: { readonly address: string; readonly name: string }) {
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const fetched = (work: () => Promise<void>) => {
    setWorking(true)
    setTrouble(null)
    work()
      .catch((error: unknown) => {
        setTrouble(error instanceof RequestRefused ? error.message : subjectAccessWords.offline)
      })
      .finally(() => {
        setWorking(false)
      })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          icon={Download}
          disabled={working}
          onClick={() => {
            fetched(async () => {
              savePdf(await fetchPdf(withFormat(address, 'pdf')), name)
            })
          }}
        >
          {subjectAccessWords.pdf}
        </Button>
        <Button
          icon={Download}
          disabled={working}
          onClick={() => {
            fetched(async () => {
              const file = await requestFile(withFormat(address, 'json'), 'application/json')

              save(file.content, file.name ?? `${name}.json`)
            })
          }}
        >
          {subjectAccessWords.json}
        </Button>
        <span className="text-[12px] text-ink-muted">{subjectAccessWords.jsonNote}</span>
      </div>
      {trouble === null ? null : (
        <span role="alert" className="text-[12px] text-conflict">
          {trouble}
        </span>
      )}
    </div>
  )
}

/** What a search found, before the file is made. */
function Matches({ term }: { readonly term: string }) {
  const found = useQuery({
    queryKey: [...choiceKey, 'matches', term],
    queryFn: () =>
      request<SubjectAccessMatch[]>(
        `/settings/subject-access/matches?term=${encodeURIComponent(term)}`,
      ),
  })

  if (found.data === undefined) {
    return (
      <SettingsText muted>
        {found.error instanceof RequestRefused
          ? found.error.message
          : found.isError
            ? subjectAccessWords.failed
            : subjectAccessWords.loading}
      </SettingsText>
    )
  }

  if (found.data.length === 0) {
    return <SettingsText muted>{subjectAccessWords.nothing(term)}</SettingsText>
  }

  return (
    <>
      <TablePanel
        title={subjectAccessWords.found(found.data.length, term)}
        caption={subjectAccessWords.found(found.data.length, term)}
        note={subjectAccessWords.foundNote}
      >
        <thead>
          <tr>
            <Column>{subjectAccessWords.where}</Column>
            <Column className="w-[230px]">{subjectAccessWords.name}</Column>
            <Column className="w-[250px]">{subjectAccessWords.email}</Column>
          </tr>
        </thead>
        <tbody>
          {found.data.map((match, index) => (
            <tr key={`${match.part}-${String(index)}`}>
              <Cell>{match.where}</Cell>
              <Cell>{match.name ?? ''}</Cell>
              <Cell>{match.email ?? ''}</Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      <Downloads
        address={`/settings/subject-access/matches/file?term=${encodeURIComponent(term)}`}
        name={`Auskunft zur Suche nach ${term}`}
      />
    </>
  )
}

/**
 * The card on "Datenschutz" (#355): for a person with an access the access,
 * for one without a search for a name or an address, and the file of either
 * as a PDF or as JSON. Only for the Leitung, which alone sees the screen, and
 * only for one that sees every area: the information is whole or nothing.
 */
export function SubjectAccessPanel() {
  const choice = useQuery({
    queryKey: choiceKey,
    queryFn: () => request<SubjectAccessChoice>('/settings/subject-access'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const [without, setWithout] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)

  if (choice.data === undefined) {
    return (
      <Panel title={subjectAccessWords.title}>
        <SettingsText muted>
          {choice.isError ? subjectAccessWords.failed : subjectAccessWords.loading}
        </SettingsText>
      </Panel>
    )
  }

  if (!choice.data.everyArea) {
    return (
      <Panel title={subjectAccessWords.title}>
        <SettingsText>{subjectAccessWords.intro}</SettingsText>
        <SettingsText muted>{subjectAccessNeedsEveryArea}</SettingsText>
      </Panel>
    )
  }

  const people = choice.data.people
  const chosen = people.find((person) => person.userId === userId) ?? people[0]

  const search = (event: FormEvent) => {
    event.preventDefault()

    const found = subjectAccessTermProblem(term)

    setProblem(found)

    if (found === null) {
      setAsked(term.trim())
    }
  }

  return (
    <Panel title={subjectAccessWords.title}>
      <div className="flex flex-col gap-3">
        <SettingsText>{subjectAccessWords.intro}</SettingsText>
        <Choice
          label={subjectAccessWords.who}
          options={[
            {
              value: 'with',
              label: subjectAccessWords.withAccess,
              note: subjectAccessWords.withAccessNote,
            },
            {
              value: 'without',
              label: subjectAccessWords.withoutAccess,
              note: subjectAccessWords.withoutAccessNote,
            },
          ]}
          value={without ? 'without' : 'with'}
          onChange={(value) => {
            setWithout(value === 'without')
          }}
        />
        {!without ? (
          chosen === undefined ? null : (
            <>
              <div className="max-w-[420px]">
                <SelectField
                  label={subjectAccessWords.access}
                  value={chosen.userId}
                  options={people.map((person) => ({
                    value: person.userId,
                    label: `${person.name}, ${person.email}`,
                  }))}
                  onChange={setUserId}
                />
              </div>
              <Downloads
                address={`/settings/subject-access/people/${encodeURIComponent(chosen.userId)}`}
                name={`Auskunft über ${chosen.name}`}
              />
            </>
          )
        ) : (
          <>
            <form className="flex flex-wrap items-end gap-2" onSubmit={search}>
              <div className="w-[320px] max-w-full">
                <Field
                  label={subjectAccessWords.term}
                  value={term}
                  {...(problem === null ? {} : { problem })}
                  onChange={(event) => {
                    setTerm(event.target.value)
                    setProblem(null)
                  }}
                />
              </div>
              <Button type="submit" icon={Search}>
                {subjectAccessWords.search}
              </Button>
            </form>
            {asked === null ? null : <Matches term={asked} />}
          </>
        )}
        <span className="text-[12px] text-ink-muted">{subjectAccessWords.what}</span>
      </div>
    </Panel>
  )
}
