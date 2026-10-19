import {
  type ProcessingActivityView,
  type ProcessingRecordView,
  recordLimits,
  recordText,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Panel,
  Status,
  type TableCard,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { NoteBox, Saved, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronLeft, Pencil, RefreshCw } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { privacyDocumentsKey } from './privacy-documents.js'

export const recordScreenWords = {
  title: 'Verzeichnis der Verarbeitungstätigkeiten',
  sub: 'Was die Anwendung nicht weiß: wer verantwortlich ist, und je Tätigkeit Zweck, Rechtsgrundlage und Empfänger.',
  back: 'Zurück zu Datenschutz',
  who: 'Wer verantwortlich ist',
  controller: 'Verantwortlicher',
  controllerHint: 'Name, Anschrift und Kontakt. Steht oben im Verzeichnis.',
  officer: 'Datenschutzbeauftragter',
  officerHint: 'Leer, wenn es keinen gibt.',
  activities: 'Tätigkeiten',
  activity: 'Tätigkeit',
  purpose: 'Zweck',
  legalBasis: 'Rechtsgrundlage',
  recipients: 'Empfänger',
  state: 'Stand',
  confirmed: 'Bestätigt',
  proposal: 'Vorschlag',
  edit: 'Bearbeiten',
  editOf: (title: string) => `${title} bearbeiten`,
  sections: (sections: readonly string[]) => `Verfahrensbeschreibung ${sections.join(', ')}`,
  caption:
    'Die Tätigkeiten des Verzeichnisses mit Zweck, Rechtsgrundlage und ob die Leitung sie bestätigt hat',
  note: (confirmed: number, open: number) =>
    `${String(confirmed)} bestätigt, ${String(open)} als Vorschlag. Ein Vorschlag steht im Verzeichnis, bis die Leitung ihn bestätigt oder ändert, und das Verzeichnis sagt bei jedem, dass er von der Anwendung kommt.`,
  subjects: 'Betroffen',
  data: 'Daten',
  deletion: 'Löschung',
  deletionRules: (rules: readonly string[]) =>
    rules.length === 0
      ? 'keine Frist; was bleibt, sagt das Löschkonzept'
      : `Regel ${rules.join(', ')} des Löschkonzepts`,
  describedIn: 'Beschrieben in',
  proposalHint: 'Vorschlag der Anwendung. Mit dem Speichern gilt er als bestätigt.',
  recipientsPlaceholder:
    'Etwa: der Dienstleister, der die Instanz betreibt; Fremdfirmen, die einen Auftrag bekommen',
  recipientsHint: 'Leer heißt: keine Empfänger außerhalb des Betreibers.',
  restore: 'Vorschlag wiederherstellen',
  cancel: 'Abbrechen',
  save: 'Speichern',
  bothOrNeither: 'Zweck und Rechtsgrundlage gehören zusammen.',
  loading: 'Wird geladen.',
  failed: 'Das Verzeichnis ließ sich nicht laden. Es kommt vom Server, mit Verbindung.',
  notSaved: 'Ließ sich nicht speichern. Das geht nur mit Verbindung zum Server.',
} as const

const recordKey = ['settings', 'processing-record'] as const

/**
 * "Einstellungen", "Datenschutz", "Verzeichnis", the boards "Verzeichnis der
 * Verarbeitungstätigkeiten: die Angaben der Leitung" and "eine Tätigkeit
 * bestätigen oder ändern" (#358): who is responsible and the data protection
 * officer, and every activity of the record with what the application proposes
 * and what the Leitung confirmed or changed. Only the Leitung comes here.
 */
export function ProcessingRecordScreen() {
  const read = useQuery({
    queryKey: recordKey,
    queryFn: () => request<ProcessingRecordView>('/settings/processing-record'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const [open, setOpen] = useState<ProcessingActivityView | null>(null)
  const navigate = useNavigate()

  return (
    <SettingsPage
      active="datenschutz"
      title={recordScreenWords.title}
      sub={recordScreenWords.sub}
      actions={
        <Button
          icon={ChevronLeft}
          onClick={() => {
            void navigate({ to: '/einstellungen/datenschutz' })
          }}
        >
          {recordScreenWords.back}
        </Button>
      }
    >
      {read.data === undefined ? (
        <SettingsText muted>
          {read.isError ? recordScreenWords.failed : recordScreenWords.loading}
        </SettingsText>
      ) : (
        <>
          <WhoPanel
            key={`${read.data.controller ?? ''}|${read.data.officer ?? ''}`}
            read={read.data}
          />
          <Activities read={read.data} onOpen={setOpen} />
        </>
      )}
      {open === null ? null : (
        <ActivityDialog
          key={open.key}
          activity={open}
          onClose={() => {
            setOpen(null)
          }}
        />
      )}
    </SettingsPage>
  )
}

function useKeep() {
  const queries = useQueryClient()

  return async (path: string, body: object) => {
    const answer = await request<ProcessingRecordView>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    })

    queries.setQueryData(recordKey, answer)
    await queries.invalidateQueries({ queryKey: privacyDocumentsKey })
  }
}

function WhoPanel({ read }: { readonly read: ProcessingRecordView }) {
  const keep = useKeep()
  const [controller, setController] = useState(read.controller ?? '')
  const [officer, setOfficer] = useState(read.officer ?? '')
  const [working, setWorking] = useState(false)
  const [saved, setSaved] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const problem = [
    recordText(controller, recordScreenWords.controller),
    recordText(officer, recordScreenWords.officer),
  ]
    .map((each) => (each !== null && typeof each === 'object' ? each.problem : null))
    .find((each) => each !== null)
  const changed =
    controller.trim() !== (read.controller ?? '') || officer.trim() !== (read.officer ?? '')

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (problem !== undefined) {
      return
    }

    setWorking(true)
    setSaved(false)
    setTrouble(null)

    try {
      await keep('/settings/processing-record', { controller, officer })
      setSaved(true)
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : recordScreenWords.notSaved)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={recordScreenWords.who} roomy>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <TextArea
          label={recordScreenWords.controller}
          hint={recordScreenWords.controllerHint}
          rows={3}
          maxLength={recordLimits.text}
          value={controller}
          onChange={(event) => {
            setSaved(false)
            setController(event.target.value)
          }}
        />
        <TextArea
          label={recordScreenWords.officer}
          hint={recordScreenWords.officerHint}
          rows={2}
          maxLength={recordLimits.text}
          value={officer}
          onChange={(event) => {
            setSaved(false)
            setOfficer(event.target.value)
          }}
        />
        {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
        <div className="flex flex-wrap items-center gap-2">
          {saved ? <Saved /> : null}
          <div className="ml-auto">
            <Button tone="primary" type="submit" icon={Check} disabled={!changed || working}>
              {recordScreenWords.save}
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  )
}

function stateOf(activity: ProcessingActivityView) {
  return activity.purpose === null ? (
    <Status tone="waiting">{recordScreenWords.proposal}</Status>
  ) : (
    <Status tone="done">{recordScreenWords.confirmed}</Status>
  )
}

function Activities({
  read,
  onOpen,
}: {
  readonly read: ProcessingRecordView
  readonly onOpen: (activity: ProcessingActivityView) => void
}) {
  const confirmed = read.activities.filter((activity) => activity.purpose !== null).length
  const edit = (activity: ProcessingActivityView) => (
    <Button
      size="small"
      icon={Pencil}
      aria-label={recordScreenWords.editOf(activity.title)}
      onClick={() => {
        onOpen(activity)
      }}
    >
      {recordScreenWords.edit}
    </Button>
  )
  const cards: readonly TableCard[] = read.activities.map((activity) => ({
    key: activity.key,
    title: activity.title,
    sub: activity.purpose ?? activity.proposedPurpose,
    right: edit(activity),
  }))

  return (
    <TablePanel
      title={recordScreenWords.activities}
      caption={recordScreenWords.caption}
      cards={cards}
      note={recordScreenWords.note(confirmed, read.activities.length - confirmed)}
    >
      <thead>
        <tr>
          <Column className="w-[230px]">{recordScreenWords.activity}</Column>
          <Column>{recordScreenWords.purpose}</Column>
          <Column className="w-[210px]">{recordScreenWords.legalBasis}</Column>
          <Column className="w-[118px]">{recordScreenWords.state}</Column>
          <Column className="w-[128px]">
            <span className="sr-only">{recordScreenWords.edit}</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {read.activities.map((activity) => (
          <tr key={activity.key}>
            <Cell>
              <span className="font-medium">{activity.title}</span>
              <span className="block text-[12px] text-ink-faint">
                {recordScreenWords.sections(activity.sections)}
              </span>
            </Cell>
            <Cell className="text-[13px]">{activity.purpose ?? activity.proposedPurpose}</Cell>
            <Cell className="text-[13px]">
              {activity.legalBasis ?? activity.proposedLegalBasis}
            </Cell>
            <Cell>{stateOf(activity)}</Cell>
            <Cell className="text-right">{edit(activity)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function ActivityDialog({
  activity,
  onClose,
}: {
  readonly activity: ProcessingActivityView
  readonly onClose: () => void
}) {
  const keep = useKeep()
  const [purpose, setPurpose] = useState(activity.purpose ?? activity.proposedPurpose)
  const [legalBasis, setLegalBasis] = useState(activity.legalBasis ?? activity.proposedLegalBasis)
  const [recipients, setRecipients] = useState(activity.recipients ?? '')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const path = `/settings/processing-record/activities/${activity.key}`

  async function send(body: object) {
    setWorking(true)
    setTrouble(null)

    try {
      await keep(path, body)
      onClose()
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : recordScreenWords.notSaved)
      setWorking(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()

    if (purpose.trim() === '' || legalBasis.trim() === '') {
      setTrouble(recordScreenWords.bothOrNeither)
      return
    }

    void send({ purpose, legalBasis, recipients })
  }

  return (
    <Dialog title={activity.title} width={600} onClose={onClose}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px] max-sm:grid-cols-1">
          {[
            [recordScreenWords.subjects, activity.subjects],
            [recordScreenWords.data, activity.data],
            [recordScreenWords.deletion, recordScreenWords.deletionRules(activity.deletion)],
            [recordScreenWords.describedIn, recordScreenWords.sections(activity.sections)],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted max-sm:mt-1">{label}</dt>
              <dd className="m-0">{value}</dd>
            </div>
          ))}
        </dl>
        <TextArea
          label={recordScreenWords.purpose}
          starred
          rows={3}
          maxLength={recordLimits.text}
          value={purpose}
          onChange={(event) => {
            setPurpose(event.target.value)
          }}
        />
        <TextArea
          label={recordScreenWords.legalBasis}
          starred
          rows={3}
          maxLength={recordLimits.text}
          {...(activity.legalBasis === null ? { hint: recordScreenWords.proposalHint } : {})}
          value={legalBasis}
          onChange={(event) => {
            setLegalBasis(event.target.value)
          }}
        />
        <TextArea
          label={recordScreenWords.recipients}
          hint={recordScreenWords.recipientsHint}
          placeholder={recordScreenWords.recipientsPlaceholder}
          rows={3}
          maxLength={recordLimits.text}
          value={recipients}
          onChange={(event) => {
            setRecipients(event.target.value)
          }}
        />
        {trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>}
        <DialogActions>
          <Button
            type="button"
            icon={RefreshCw}
            disabled={working || activity.purpose === null}
            onClick={() => {
              void send({ purpose: null, legalBasis: null, recipients })
            }}
          >
            {recordScreenWords.restore}
          </Button>
          <span className="grow" />
          <Button type="button" disabled={working} onClick={onClose}>
            {recordScreenWords.cancel}
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {recordScreenWords.save}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
