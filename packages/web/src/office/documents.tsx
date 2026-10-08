import {
  type DocumentKind,
  documentKindLabel,
  documentKinds,
  documentLimits,
  documentProblems,
  documentTitleOf,
  fileMediaType,
  isPhoto,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
} from '@opengewerk/platform-web'
import { useVersions } from '@opengewerk/platform-web/attachments'
import { fileSize } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, refusalFor, text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'
import { FileText, Upload } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'

import {
  type DocumentPlace,
  type DocumentSurroundings,
  documentWords,
  fileDocument,
  documentsAt,
  newestFirst,
  versionWords,
} from '../app/documents.js'
import { documentPlaces } from './document-addresses.js'
import { factLink } from './links.js'

/**
 * The documents of an operator in the office (#97, section 4.10 of the
 * concept): the card at an asset, a room and a property, and the three things
 * done to a document, each in a dialog of its own: filing one, correcting its
 * name and its kind, and taking it out of the records.
 *
 * Everything here is read from the device and written through its outbox,
 * unlike most of what the office writes (ADR 0006, addendum of #97): a file
 * goes to the store ahead of its record, and the way a photo taken without a
 * network goes is the way every document goes. So filing works without a
 * connection as well, and the list says of a version that it has not gone up
 * yet.
 *
 * Whoever may file documents files one, lays a version over it and corrects
 * its name and kind; taking one out is offered from the Objektleitung on
 * (section 7 of the concept), and nothing here is offered to anybody else.
 */

export const documentCardWords = {
  none: 'Hier ist noch kein Dokument abgelegt.',
  whatFilingIs:
    'Die Datei geht in die Ablage und steht danach auf den Geräten vor Ort, mit einer Fassung.',
  elsewhere:
    'An einer Anlage oder einem Raum wird ein Dokument auf deren Seite abgelegt. Es bleibt, wo es abgelegt wurde.',
  staysHere: 'Ein Dokument bleibt, wo es abgelegt wurde.',
  noFile: 'Es ist noch keine Datei gewählt.',
  noProperty: 'Die Liegenschaft fehlt.',
  wholeProperty: 'Die ganze Liegenschaft',
  keepOriginal: 'Foto in voller Größe behalten',
  shrunk: 'Ein Foto wird sonst verkleinert, damit es auch ohne gutes Netz ankommt.',
  whatCorrectingIs:
    'Bezeichnung und Art lassen sich berichtigen. Woran ein Dokument hängt, bleibt.',
  removal:
    'Das Dokument steht danach nicht mehr in der Ablage, auch nicht auf den Geräten vor Ort. Seine Fassungen bleiben aufbewahrt.',
} as const

/** The records of this device a document may name. */
export function useDocumentSurroundings(): DocumentSurroundings {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')
  const activities = useRecords('activities')
  const defects = useRecords('defects')

  return useMemo(
    () => ({ properties, buildings, rooms, assets, activities, defects }),
    [properties, buildings, rooms, assets, activities, defects],
  )
}

function Trouble({ children }: { readonly children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

const kindChoices = [
  { value: '', label: documentWords.noKind },
  ...documentKinds.map((kind) => ({ value: kind, label: documentKindLabel[kind] })),
]

/** The two fields a document is named with, in the dialog that files one and the one that corrects one. */
function NameAndKind({
  title,
  kind,
  problem,
  onTitle,
  onKind,
}: {
  readonly title: string
  readonly kind: string
  readonly problem: string | undefined
  readonly onTitle: (title: string) => void
  readonly onKind: (kind: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
      <Field
        label="Bezeichnung"
        required
        starred
        maxLength={documentLimits.title}
        value={title}
        problem={problem}
        onChange={(event) => {
          onTitle(event.target.value)
        }}
      />
      <SelectField label="Art" options={kindChoices} value={kind} onChange={onKind} />
    </div>
  )
}

/**
 * Filing a document, `dokument_hochladen()` of the boards: the file, its
 * name, which begins as the name of the file, its kind, and where it hangs.
 *
 * At an asset, a room or a property the place is the page the dialog was
 * opened from, and the dialog says so. From the screen "Dokumente" somebody
 * chooses the property and, on request, one of its buildings.
 */
export function UploadDocumentDialog({
  place,
  at,
  onClose,
}: {
  /** Where the document hangs, where the page it is filed from says so. */
  readonly place?: DocumentPlace
  /** That place in words: "AN-00057 Trinkwassererwärmer". */
  readonly at?: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const picker = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [keepOriginal, setKeepOriginal] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)

  const byName = (records: readonly RecordState[]) =>
    [...records].sort((left, right) => text(left, 'name').localeCompare(text(right, 'name'), 'de'))
  const itsBuildings = byName(buildings.filter((building) => building['propertyId'] === propertyId))
  const nameProblem = asked ? documentProblems({ title })['title'] : undefined
  const photo = file !== null && isPhoto(fileMediaType(file.type))

  function choose(files: FileList | null) {
    const chosen = files?.[0]

    // A dialog closed without a choice is no answer: what was chosen stays.
    if (!chosen) {
      return
    }

    // The name follows the file while nobody has typed another.
    if (title.trim() === '' || (file !== null && title === documentTitleOf(file.name))) {
      setTitle(documentTitleOf(chosen.name))
    }

    setFile(chosen)
    setTrouble(null)
  }

  async function submit() {
    setAsked(true)

    if (file === null) {
      setTrouble(documentCardWords.noFile)

      return
    }

    if (place === undefined && propertyId === '') {
      setTrouble(documentCardWords.noProperty)

      return
    }

    if (documentProblems({ title })['title'] !== undefined) {
      setTrouble(null)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const refused = await fileDocument(
        client,
        place ?? { propertyId, ...(buildingId === '' ? {} : { buildingId }) },
        file,
        { title, kind: kind === '' ? null : (kind as DocumentKind), keepOriginal },
      )

      if (refused === null) {
        onClose()
      } else {
        setTrouble(refused)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Dokument hochladen"
      width={600}
      onClose={onClose}
      sub={documentCardWords.whatFilingIs}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <input
          ref={picker}
          type="file"
          className="sr-only"
          aria-label="Datei wählen"
          tabIndex={-1}
          onChange={(event) => {
            choose(event.target.files)
            event.target.value = ''
          }}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink max-lg:text-[15px]">
            Datei{' '}
            <span aria-hidden="true" className="text-conflict">
              *
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-line bg-surface-sunken px-2.5 py-2">
            <FileText
              size={18}
              strokeWidth={1.9}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
            <div className="min-w-0 grow leading-[1.32]">
              {file === null ? (
                <span className="text-[14px] text-ink-muted">{documentCardWords.noFile}</span>
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
              {file === null ? 'Datei wählen' : 'Andere Datei'}
            </Button>
          </div>
        </div>
        <NameAndKind
          title={title}
          kind={kind}
          problem={nameProblem}
          onTitle={setTitle}
          onKind={setKind}
        />
        {place === undefined ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Liegenschaft"
                required
                starred
                options={[
                  { value: '', label: 'Bitte wählen' },
                  ...byName(properties).map((property) => ({
                    value: String(property['id']),
                    label: text(property, 'name'),
                  })),
                ]}
                value={propertyId}
                onChange={(value) => {
                  setPropertyId(value)
                  setBuildingId('')
                }}
              />
              <SelectField
                label="Gebäude"
                options={[
                  { value: '', label: documentCardWords.wholeProperty },
                  ...itsBuildings.map((building) => ({
                    value: String(building['id']),
                    label: text(building, 'name'),
                  })),
                ]}
                value={buildingId}
                onChange={setBuildingId}
              />
            </div>
            <NoteBox>{documentCardWords.elsewhere}</NoteBox>
          </>
        ) : (
          <NoteBox>
            Hängt an: <strong className="font-semibold">{at}</strong>. {documentCardWords.staysHere}
          </NoteBox>
        )}
        {photo ? (
          <label className="inline-flex min-h-6 items-start gap-[7px] text-[14px] max-lg:min-h-tap">
            <input
              type="checkbox"
              className="mt-[3px] size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
              checked={keepOriginal}
              onChange={(event) => {
                setKeepOriginal(event.target.checked)
              }}
            />
            <span>
              {documentCardWords.keepOriginal}
              <span className="block text-[12px] text-ink-faint">{documentCardWords.shrunk}</span>
            </span>
          </label>
        ) : null}
        <Trouble>{trouble}</Trouble>
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Hochladen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * Correcting the name and the kind of a document, `dokument_bearbeiten()` of
 * the boards. What it hangs on stays: a document is never moved.
 */
export function EditDocumentDialog({
  document,
  onClose,
}: {
  readonly document: RecordState
  readonly onClose: () => void
}) {
  const client = useSync()
  const [title, setTitle] = useState(text(document, 'title'))
  const [kind, setKind] = useState(maybeText(document, 'kind') ?? '')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)
  const nameProblem = asked ? documentProblems({ title })['title'] : undefined

  async function submit() {
    setAsked(true)

    if (documentProblems({ title })['title'] !== undefined) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const result = await client.update('attachments', String(document['id']), {
        title: title.trim(),
        kind: kind === '' ? null : kind,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      } else {
        onClose()
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Dokument bearbeiten"
      width={520}
      onClose={onClose}
      sub={documentCardWords.whatCorrectingIs}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <NameAndKind
          title={title}
          kind={kind}
          problem={nameProblem}
          onTitle={setTitle}
          onKind={setKind}
        />
        <Trouble>{trouble}</Trouble>
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * The question before a document is taken out of the records. It is marked
 * and never deleted; its versions and their files stay.
 */
export function RemoveDocumentConfirm({
  document,
  onClose,
  onRemoved,
}: {
  readonly document: RecordState
  readonly onClose: () => void
  /** Once it is out of the records, for a screen that showed it. */
  readonly onRemoved?: () => void
}) {
  const client = useSync()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function remove() {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await client.remove('attachments', String(document['id']))

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      } else {
        onClose()
        onRemoved?.()
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Confirm
      open
      title={`${text(document, 'title')} entfernen?`}
      confirm="Entfernen"
      tone="danger"
      busy={working}
      onConfirm={() => {
        void remove()
      }}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-2">
        <p>{documentCardWords.removal}</p>
        <Trouble>{trouble}</Trouble>
      </div>
    </Confirm>
  )
}

/**
 * The card "Dokumente" at an asset, a room and a property, as the boards draw
 * it in the narrow column: the documents that hang on that record, the one
 * changed last first, each with the file of its newest version, and the
 * button that files one here.
 *
 * A document opens on the screen "Dokumente", with its versions. The card
 * stands for whoever may look at documents and for nobody else.
 */
export function DocumentsCard({
  place,
  at,
  title = 'Dokumente',
}: {
  /** The record the documents hang on: the property alone for those of the property itself. */
  readonly place: DocumentPlace
  /** That record in words, for the dialog that files one here. */
  readonly at: string
  /** What the card is called: "Fotos" at a defect. */
  readonly title?: string
}) {
  const client = useSync()
  const reads = useRight('document.read')
  const files = useRight('document.record')
  const documents = useRecords('attachments')
  const versions = useVersions()
  const [filing, setFiling] = useState(false)

  const here = useMemo(
    () => newestFirst(documentsAt(documents, place), versions),
    [documents, versions, place],
  )

  if (!reads) {
    return null
  }

  return (
    <Panel
      title={title}
      action={
        files ? (
          <Button
            size="small"
            icon={Upload}
            onClick={() => {
              setFiling(true)
            }}
          >
            Hochladen
          </Button>
        ) : null
      }
    >
      {here.length === 0 ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">{documentCardWords.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {here.map((document) => {
            const id = String(document['id'])
            const all = versions.get(id) ?? []
            const newest = all[0]

            return (
              <li key={id} className="leading-[1.3]">
                <Link to={documentPlaces.document(id)} className={factLink}>
                  {text(document, 'title')}
                </Link>
                <div className="text-[12px] text-ink-faint [overflow-wrap:anywhere]">
                  {newest ? versionWords(client, newest, all.length) : documentWords.onItsWay}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {filing ? (
        <UploadDocumentDialog
          place={place}
          at={at}
          onClose={() => {
            setFiling(false)
          }}
        />
      ) : null}
    </Panel>
  )
}
