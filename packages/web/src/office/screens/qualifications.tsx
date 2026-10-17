import {
  byNameIn,
  type PersonLevel,
  personLevelLabel,
  personLevels,
  type QualificationEntry,
  type QualificationKindChoice,
  qualificationKindProblems,
  qualificationLimits,
  qualificationProblems,
  type QualificationStanding,
  qualificationStandingLabel,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, fileSize } from '@opengewerk/platform-web/format'
import { Empty, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, List, Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeferredValue, useRef, useState } from 'react'

import { usePdf } from '../pdf-button.js'
import {
  certificateAddress,
  qualificationKey,
  qualificationKindsQuery,
  qualificationListQuery,
  sendCertificate,
} from '../qualification-addresses.js'
import { dutyColleaguesQuery } from './duty.js'

/**
 * "Qualifikationen" (#337, 4.3 of the concept), as the boards of that name
 * draw them: every qualification with its person, its kind, until when it
 * holds and how it stands, with its certificate; entering one, changing and
 * taking it out; and the kinds of the packages beside the operator's own.
 * The Leitung, the Technische Leitung and the Objektleitung look at them,
 * the Leitung and the Technische Leitung keep them.
 */

export const qualificationWords = {
  sub: 'Wer was ausführen darf, mit Nachweis und Ablauf. Wer eine Prüfung, eine Wartung oder einen Auftrag zuteilt, bekommt einen Hinweis, wenn die geforderte Qualifikation fehlt oder abgelaufen ist.',
  listNote:
    'Eine Qualifikation mit Ablauf ist eine Frist unter „Fristen“; vorher erinnert sie die Leitung. Den Nachweis sieht, wer Qualifikationen ansieht, und die Person selbst unter „Konto“.',
  none: 'Noch ist keine Qualifikation eingetragen.',
  noneFound: 'Keine Qualifikation passt zu dem, wonach die Liste eingegrenzt ist.',
  loading: 'Die Qualifikationen werden geladen.',
  failed: 'Die Qualifikationen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  noConnection: 'Die Qualifikationen kommen vom Server. Gerade ist keine Verbindung da.',
  kindHint: 'Aus den Paketen oder eine eigene Art des Betreibers.',
  untilHint: 'Leer, wenn sie nicht abläuft. Das Ende wird eine Frist unter „Fristen“.',
  certificateNote:
    'Der Nachweis bleibt an der Qualifikation und geht nicht in die Ablage. Ihn sieht, wer Qualifikationen ansieht, und die Person selbst.',
  removeQuestion:
    'Diese Qualifikation herausnehmen? Sie bleibt im Änderungsprotokoll, und ihre Frist entfällt.',
  kindsIntro:
    'Die Arten aus den Paketen kommen mit dem Katalog; jede Pflichtart, deren Quelle eine Person nennt, fordert eine davon. Eine eigene Art ergänzt sie, etwa für eine Schulung des Betreibers, und fordert keine Pflichtart.',
} as const

const standingLooks: Readonly<Record<QualificationStanding, StatusTone>> = {
  valid: 'done',
  expiring: 'waiting',
  expired: 'conflict',
}

function StandingStatus({ standing }: { readonly standing: QualificationStanding }) {
  return <Status tone={standingLooks[standing]}>{qualificationStandingLabel[standing]}</Status>
}

/** The certificate of a qualification, opened in a tab of its own. */
function Certificate({ entry }: { readonly entry: QualificationEntry }) {
  const file = usePdf(
    certificateAddress(entry.id),
    `Nachweis ${entry.kind.label} ${entry.personName}`,
    'Nachweis',
    FileText,
  )

  return (
    <div className="flex flex-col items-end gap-1">
      {file.button}
      {file.trouble}
    </div>
  )
}

/** "Eine Qualifikation ist abgelaufen, 2 laufen in den nächsten 60 Tagen ab." */
function countsWords(expired: number, expiring: number, leadDays: number): string {
  const counted = (count: number) => (count === 1 ? 'eine' : String(count))
  const parts = [
    ...(expired === 0
      ? []
      : [
          `${counted(expired)} ${expired === 1 ? 'Qualifikation ist' : 'Qualifikationen sind'} abgelaufen`,
        ]),
    ...(expiring === 0
      ? []
      : [
          `${counted(expiring)} ${expiring === 1 ? 'läuft' : 'laufen'} in den nächsten ${String(leadDays)} Tagen ab`,
        ]),
  ]

  return `${parts.join(', ')}.`.replace(/^./, (first) => first.toLocaleUpperCase('de'))
}

const refusedOnce = (count: number, error: Error) => !(error instanceof RequestRefused) && count < 2

export function QualificationListScreen() {
  const keeps = useRight('qualification.write')
  const listed = useQuery({ ...qualificationListQuery, retry: refusedOnce })
  const kinds = useQuery(qualificationKindsQuery)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [standing, setStanding] = useState('')
  const [entering, setEntering] = useState(false)
  const [changing, setChanging] = useState<QualificationEntry | null>(null)
  const [showingKinds, setShowingKinds] = useState(false)
  const wanted = useDeferredValue(search.trim().toLocaleLowerCase('de'))
  const all = listed.data?.qualifications ?? []
  const rows = all.filter(
    (entry) =>
      (kind === '' || entry.kind.key === kind) &&
      (standing === '' || entry.standing === standing) &&
      (wanted === '' || entry.personName.toLocaleLowerCase('de').includes(wanted)),
  )
  const action = (entry: QualificationEntry) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {entry.hasCertificate ? <Certificate entry={entry} /> : null}
      {keeps ? (
        <Button
          size="small"
          icon={Pencil}
          aria-label={`${entry.kind.label} von ${entry.personName} bearbeiten`}
          onClick={() => {
            setChanging(entry)
          }}
        >
          Bearbeiten
        </Button>
      ) : null}
    </div>
  )

  return (
    <Screen>
      <PageHead
        title="Qualifikationen"
        {...(listed.data === undefined
          ? {}
          : {
              count: all.length === 1 ? '1 Qualifikation' : `${String(all.length)} Qualifikationen`,
            })}
        sub={qualificationWords.sub}
      />
      {listed.data === undefined ||
      (listed.data.expired === 0 && listed.data.expiring === 0) ? null : (
        <NoteBox tone="waiting">
          {countsWords(listed.data.expired, listed.data.expiring, listed.data.leadDays)}
        </NoteBox>
      )}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div className="w-[240px] max-lg:w-full">
          <Field
            label="Suche"
            type="search"
            value={search}
            placeholder="Person"
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <div className="w-[260px] max-lg:w-full">
          <SelectField
            label="Qualifikation"
            value={kind}
            options={[
              { value: '', label: 'Alle' },
              ...(kinds.data ?? []).map((each) => ({ value: each.key, label: each.label })),
            ]}
            onChange={setKind}
          />
        </div>
        <div className="w-[180px] max-lg:w-full">
          <SelectField
            label="Stand"
            value={standing}
            options={[
              { value: '', label: 'Alle' },
              ...(['valid', 'expiring', 'expired'] as const).map((each) => ({
                value: each,
                label: qualificationStandingLabel[each],
              })),
            ]}
            onChange={setStanding}
          />
        </div>
        <span className="grow max-lg:hidden" />
        <Button
          icon={List}
          onClick={() => {
            setShowingKinds(true)
          }}
        >
          Arten
        </Button>
        {keeps ? (
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              setEntering(true)
            }}
          >
            Qualifikation eintragen
          </Button>
        ) : null}
      </div>
      {listed.data === undefined ? (
        <Panel>
          <Empty>
            {listed.isError
              ? qualificationWords.failed
              : listed.fetchStatus === 'paused'
                ? qualificationWords.noConnection
                : qualificationWords.loading}
          </Empty>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>{all.length === 0 ? qualificationWords.none : qualificationWords.noneFound}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Qualifikationen mit Person, Art, gültig bis und Stand"
          note={qualificationWords.listNote}
          cards={rows.map((entry) => ({
            key: entry.id,
            title: entry.personName,
            sub: [
              entry.kind.label,
              entry.validUntil === null ? 'ohne Ablauf' : `bis ${date(entry.validUntil)}`,
            ].join(' · '),
            right: <StandingStatus standing={entry.standing} />,
          }))}
        >
          <thead>
            <tr>
              <Column className="w-[210px] min-w-[160px]">Person</Column>
              <Column className="min-w-[220px]">Qualifikation</Column>
              <Column className="w-[130px] min-w-[110px]">Gültig bis</Column>
              <Column className="w-[150px] min-w-[130px]">Stand</Column>
              <Column className="w-[220px] min-w-[150px]">
                <span className="sr-only">Nachweis und Bearbeiten</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <Cell>
                  <span className="font-medium">{entry.personName}</span>
                </Cell>
                <Cell>
                  <div className="leading-[1.32]">
                    <div>{entry.kind.label}</div>
                    <div className="text-[12px] text-ink-faint">{entry.kind.origin}</div>
                  </div>
                </Cell>
                <Cell>{entry.validUntil === null ? 'ohne Ablauf' : date(entry.validUntil)}</Cell>
                <Cell>
                  <StandingStatus standing={entry.standing} />
                </Cell>
                <Cell align="right">{action(entry)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {entering ? (
        <QualificationDialog
          kinds={kinds.data ?? []}
          onClose={() => {
            setEntering(false)
          }}
        />
      ) : null}
      {changing === null ? null : (
        <QualificationDialog
          kinds={kinds.data ?? []}
          entry={changing}
          onClose={() => {
            setChanging(null)
          }}
        />
      )}
      {showingKinds ? (
        <KindsDialog
          kinds={kinds.data ?? []}
          keeps={keeps}
          onClose={() => {
            setShowingKinds(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** "Qualifikation eintragen", and the same form to change one: its person and kind stay. */
export function QualificationDialog({
  kinds,
  entry,
  onClose,
}: {
  readonly kinds: readonly QualificationKindChoice[]
  readonly entry?: QualificationEntry
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const colleagues = useQuery({ ...dutyColleaguesQuery, enabled: entry === undefined })
  const picker = useRef<HTMLInputElement>(null)
  const [userId, setUserId] = useState(entry?.userId ?? '')
  const [kind, setKind] = useState(entry?.kind.key ?? '')
  const [validUntil, setValidUntil] = useState(entry?.validUntil ?? '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const people = (colleagues.data ?? [])
    .filter((each) => each.active)
    .sort((left, right) => byNameIn(left.name, right.name))

  async function send() {
    const values = {
      userId,
      kind,
      validUntil: validUntil === '' ? null : validUntil,
      note: note.trim() === '' ? null : note.trim(),
    }
    const found = qualificationProblems({
      ...values,
      kindKey: kind === '' ? null : kind,
    })

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const certificate = file === null ? {} : { certificateSha256: await sendCertificate(file) }

      await request(
        entry === undefined ? '/qualifications' : `/qualifications/${encodeURIComponent(entry.id)}`,
        {
          method: entry === undefined ? 'POST' : 'PATCH',
          body: JSON.stringify(
            entry === undefined
              ? { ...values, ...certificate }
              : { validUntil: values.validUntil, note: values.note, ...certificate },
          ),
        },
      )
      await queries.invalidateQueries({ queryKey: qualificationKey })
      onClose()
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : qualificationWords.noConnection)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title={entry === undefined ? 'Qualifikation eintragen' : 'Qualifikation bearbeiten'}
      width={640}
      onClose={onClose}
      {...(entry === undefined ? {} : { sub: `${entry.kind.label}, ${entry.personName}` })}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {entry === undefined ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Person"
              required
              starred
              value={userId}
              options={[
                { value: '', label: 'Bitte wählen' },
                ...people.map((person) => ({ value: person.userId, label: person.name })),
              ]}
              onChange={setUserId}
              {...(problems['userId'] === undefined ? {} : { problem: problems['userId'] })}
            />
            <SelectField
              label="Qualifikation"
              required
              starred
              value={kind}
              hint={qualificationWords.kindHint}
              options={[
                { value: '', label: 'Bitte wählen' },
                ...kinds.map((each) => ({ value: each.key, label: each.label })),
              ]}
              onChange={setKind}
              {...(problems['kind'] === undefined ? {} : { problem: problems['kind'] })}
            />
          </div>
        ) : null}
        <div className="w-[220px] max-sm:w-full">
          <Field
            label="Gültig bis"
            type="date"
            value={validUntil}
            hint={qualificationWords.untilHint}
            {...(problems['validUntil'] === undefined ? {} : { problem: problems['validUntil'] })}
            onChange={(event) => {
              setValidUntil(event.target.value)
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink max-lg:text-[15px]">Nachweis</span>
          <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-line bg-surface-sunken px-2.5 py-2">
            <FileText
              size={18}
              strokeWidth={1.9}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
            <div className="min-w-0 grow leading-[1.32]">
              {file === null ? (
                <span className="text-[14px] text-ink-muted">
                  {entry?.hasCertificate === true
                    ? 'Ein Nachweis ist abgelegt.'
                    : 'Kein Nachweis gewählt.'}
                </span>
              ) : (
                <>
                  <div className="text-[14px] font-medium [overflow-wrap:anywhere]">
                    {file.name}
                  </div>
                  <div className="text-[12px] text-ink-faint">{fileSize(file.size)}</div>
                </>
              )}
            </div>
            <Button
              type="button"
              size="small"
              disabled={working}
              onClick={() => {
                picker.current?.click()
              }}
            >
              {file === null && entry?.hasCertificate !== true ? 'Datei wählen' : 'Andere Datei'}
            </Button>
          </div>
          <input
            ref={picker}
            type="file"
            accept="application/pdf,image/*"
            hidden
            aria-label="Nachweis wählen"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
        </div>
        <TextArea
          label="Notiz"
          rows={2}
          maxLength={qualificationLimits.note}
          value={note}
          problem={problems['note']}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        <NoteBox>{qualificationWords.certificateNote}</NoteBox>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          {entry === undefined ? null : (
            <Button
              type="button"
              tone="danger"
              icon={Trash2}
              disabled={working}
              onClick={() => {
                setRemoving(true)
              }}
            >
              Herausnehmen
            </Button>
          )}
          <span className="grow" />
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Einen Moment' : entry === undefined ? 'Eintragen' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
      {removing && entry !== undefined ? (
        <Confirm
          open
          title="Qualifikation herausnehmen"
          tone="danger"
          confirm="Herausnehmen"
          onCancel={() => {
            setRemoving(false)
          }}
          onConfirm={async () => {
            try {
              await request(`/qualifications/${encodeURIComponent(entry.id)}`, {
                method: 'DELETE',
              })
              await queries.invalidateQueries({ queryKey: qualificationKey })
              onClose()
            } catch (error) {
              setRemoving(false)
              setTrouble(
                error instanceof RequestRefused ? error.message : qualificationWords.noConnection,
              )
            }
          }}
        >
          {qualificationWords.removeQuestion}
        </Confirm>
      ) : null}
    </Dialog>
  )
}

/** "Arten der Qualifikation": those of the packages, and the operator's own beside them. */
function KindsDialog({
  kinds,
  keeps,
  onClose,
}: {
  readonly kinds: readonly QualificationKindChoice[]
  readonly keeps: boolean
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [label, setLabel] = useState('')
  const [level, setLevel] = useState<PersonLevel>('instructed_person')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function add() {
    const found = qualificationKindProblems({ label, level })

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      await request('/qualifications/kinds', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), level }),
      })
      setLabel('')
      await queries.invalidateQueries({ queryKey: qualificationKey })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : qualificationWords.noConnection)
    } finally {
      setWorking(false)
    }
  }

  async function remove(key: string) {
    setTrouble(null)

    try {
      await request(`/qualifications/kinds/${encodeURIComponent(key.slice('own:'.length))}`, {
        method: 'DELETE',
      })
      await queries.invalidateQueries({ queryKey: qualificationKey })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : qualificationWords.noConnection)
    }
  }

  return (
    <Dialog title="Arten der Qualifikation" width={640} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[1.45] text-ink-muted">{qualificationWords.kindsIntro}</p>
        <TablePanel
          caption="Arten der Qualifikation mit Herkunft, Stufe und wie viele Pflichtarten sie fordern"
          grow={false}
          cards={kinds.map((each) => ({
            key: each.key,
            title: each.label,
            sub: [each.origin, personLevelLabel[each.level]].join(' · '),
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[170px]">Art</Column>
              <Column className="w-[150px] min-w-[130px]">Stufe</Column>
              <Column className="w-[120px] min-w-[100px]">Gefordert von</Column>
              <Column className="w-[120px] min-w-[110px]">
                <span className="sr-only">Entfernen</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {kinds.map((each) => (
              <tr key={each.key}>
                <Cell>
                  <div className="leading-[1.32]">
                    <div>{each.label}</div>
                    <div className="text-[12px] text-ink-faint">{each.origin}</div>
                  </div>
                </Cell>
                <Cell>{personLevelLabel[each.level]}</Cell>
                <Cell>
                  {each.origin === 'Eigene Art'
                    ? 'keine'
                    : each.requiredFor === 1
                      ? '1 Pflichtart'
                      : `${String(each.requiredFor)} Pflichtarten`}
                </Cell>
                <Cell align="right">
                  {keeps && each.key.startsWith('own:') ? (
                    <Button
                      size="small"
                      icon={Trash2}
                      aria-label={`${each.label} entfernen`}
                      onClick={() => {
                        void remove(each.key)
                      }}
                    >
                      Entfernen
                    </Button>
                  ) : null}
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
        {keeps ? (
          <form
            noValidate
            className="flex flex-wrap items-end gap-2.5"
            onSubmit={(event) => {
              event.preventDefault()
              void add()
            }}
          >
            <div className="min-w-0 grow basis-[200px] max-sm:basis-full">
              <Field
                label="Eigene Art"
                value={label}
                placeholder="Bezeichnung"
                maxLength={qualificationLimits.kindLabel}
                {...(problems['label'] === undefined ? {} : { problem: problems['label'] })}
                onChange={(event) => {
                  setLabel(event.target.value)
                }}
              />
            </div>
            <div className="w-[190px] max-sm:w-full">
              <SelectField
                label="Stufe"
                value={level}
                options={personLevels.map((each) => ({
                  value: each,
                  label: personLevelLabel[each],
                }))}
                onChange={(value) => {
                  setLevel(value as PersonLevel)
                }}
              />
            </div>
            <Button type="submit" icon={Plus} disabled={working}>
              Hinzufügen
            </Button>
          </form>
        ) : null}
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" onClick={onClose}>
            Schließen
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}
