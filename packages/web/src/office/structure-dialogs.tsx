import type { RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Dialog } from '@opengewerk/platform-web'
import { NoteBox } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  type Draft,
  type EditResult,
  maybeText,
  RecordForm,
  requestFile,
  RequestRefused,
  text,
  useSync,
} from '@opengewerk/platform-web/sync'
import { Printer } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import {
  asBoard,
  asEquipment,
  asSection,
  boardFields,
  circuitChartAddress,
  CircuitForm,
  circuitTitle,
  circuitsInWords,
  equipmentFields,
  newBoard,
  nextPosition,
  ordered,
  sectionFields,
  sectionsInWords,
  structureWords,
} from '../app/electrical.js'
import {
  asBoardPlace,
  boardPlaceFields,
  boardPlaceValues,
  useBoardPlaces,
} from '../app/board-places.js'
import { save } from './evidence-register.js'
import { RemovePlace } from './place-forms.js'

/**
 * The dialogs of the electrical structure in the office (#349): a board, a
 * section, a circuit and a piece of equipment, each added and changed over
 * the page it belongs to, and the button that prints the circuit chart.
 *
 * The circuit is the dialog of the board "Stromkreis bearbeiten", with the
 * form of the foundation; board, section and equipment are not drawn and
 * stand in the same frame with the fields the foundation names for them.
 * Everything is written through the outbox, so the structure is taken down
 * without a network as well. Adding and changing is for whoever takes stock
 * of assets, and the screens offer these dialogs to nobody else; only
 * "Entfernen" asks for the right to keep them, and is missing without it.
 */

/**
 * "Stromkreisverzeichnis", the way the book of an asset is handed out (#437):
 * the server prints it and the browser keeps the file, under the name the
 * server gives it. The chart of every board of the asset, or of the one board
 * whose door it is for. What the server says when it prints none stands where
 * the page puts `trouble`.
 */
export function useChart(
  assetId: string,
  boardId?: string,
  size: 'normal' | 'small' = 'normal',
): { readonly button: ReactNode; readonly trouble: ReactNode } {
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  return {
    button: (
      <Button
        icon={Printer}
        size={size}
        disabled={working}
        onClick={() => {
          setWorking(true)
          setTrouble(null)
          requestFile(circuitChartAddress(assetId, boardId), 'application/pdf')
            .then((file) => {
              save(file.content, file.name ?? 'Stromkreisverzeichnis.pdf')
            })
            .catch((error: unknown) => {
              setTrouble(error instanceof RequestRefused ? error.message : structureWords.noChart)
            })
            .finally(() => {
              setWorking(false)
            })
        }}
      >
        Stromkreisverzeichnis
      </Button>
    ),
    trouble: trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>,
  }
}

/** What goes with a board that is removed, in words. */
function boardContents(sections: number, circuits: number): string {
  if (sections === 0 && circuits === 0) {
    return 'Der Verteiler ist leer, es geht nichts mit.'
  }

  const parts = [
    sections === 0 ? null : sectionsInWords(sections),
    circuits === 0 ? null : circuitsInWords(circuits),
  ].filter((part): part is string => part !== null)

  return `Mit dem Verteiler gehen ${parts.join(' und ')}${circuits === 0 ? '' : ' samt ihren Betriebsmitteln'}.`
}

/**
 * A board added to an asset, or changed. A new one starts as the main
 * distribution where it is the first, as the foundation suggests, and goes to
 * the end of the list.
 */
export function BoardDialog({
  assetId,
  assetName,
  building = null,
  room = null,
  board,
  boards,
  sections = 0,
  circuits = 0,
  onClose,
  onRemoved,
}: {
  readonly assetId: string
  /** The asset by its name, under the heading. */
  readonly assetName: string
  /**
   * The building a new board stands in, where it is added on the page of a
   * building (#495); left out, the building of the asset.
   */
  readonly building?: string | null
  /** The room a new board stands in, where it is added on the page of a room. */
  readonly room?: string | null
  /** The board to change; none for a new one. */
  readonly board?: RecordState | null
  /** Every board of the asset, in order. */
  readonly boards: readonly RecordState[]
  /** How many sections and circuits the board has, for the question before it goes. */
  readonly sections?: number
  readonly circuits?: number
  readonly onClose: () => void
  readonly onRemoved?: () => void | Promise<void>
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const places = useBoardPlaces(assetId)
  const boardId = board ? String(board['id']) : null
  const name = text(board, 'designation')
  const fields = [...boardFields, ...boardPlaceFields(places)]

  return (
    <Dialog
      title={boardId === null ? 'Verteiler hinzufügen' : `${name} bearbeiten`}
      sub={assetName}
      width={600}
      onClose={onClose}
    >
      <RecordForm
        key={boardId ?? `new-${assetId}-${building ?? ''}`}
        fields={fields}
        record={{
          ...(board ?? newBoard(boards)),
          ...boardPlaceValues(board, building ?? places.own, room),
        }}
        starred
        submitLabel={boardId === null ? 'Hinzufügen' : 'Speichern'}
        onCancel={onClose}
        onSubmit={async (values) => {
          const result =
            boardId === null
              ? await client.create('distribution_boards', {
                  ...asBoard(values),
                  ...asBoardPlace(values),
                  assetId,
                  position: nextPosition(boards),
                })
              : await client.update('distribution_boards', boardId, {
                  ...asBoard(values),
                  ...asBoardPlace(values),
                })

          if (result.outcome === 'queued') {
            onClose()
          }

          return result
        }}
        extraAction={
          boardId !== null && keeps ? (
            <RemovePlace
              label="Entfernen"
              question={`„${name}“ entfernen?`}
              disabled={false}
              remove={() => client.remove('distribution_boards', boardId)}
              onRemoved={async () => {
                onClose()
                await onRemoved?.()
              }}
            >
              {boardContents(sections, circuits)}
            </RemovePlace>
          ) : undefined
        }
      />
    </Dialog>
  )
}

/** A section added to a board, at its end, or changed. */
export function SectionDialog({
  board,
  sub,
  section,
  sections,
  circuits = 0,
  onClose,
}: {
  readonly board: RecordState
  /** The board and its asset, under the heading. */
  readonly sub: string
  readonly section?: RecordState | null
  /** Every section of the board, in order. */
  readonly sections: readonly RecordState[]
  /** How many circuits the section has, for the question before it goes. */
  readonly circuits?: number
  readonly onClose: () => void
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const boardId = String(board['id'])
  const sectionId = section ? String(section['id']) : null
  const name = text(section, 'designation')

  return (
    <Dialog
      title={sectionId === null ? 'Feld hinzufügen' : `${name} bearbeiten`}
      sub={sub}
      width={520}
      onClose={onClose}
    >
      <RecordForm
        key={sectionId ?? `new-${boardId}`}
        fields={sectionFields}
        record={section ?? null}
        starred
        submitLabel={sectionId === null ? 'Hinzufügen' : 'Speichern'}
        onCancel={onClose}
        onSubmit={async (values) => {
          const result =
            sectionId === null
              ? await client.create('board_sections', {
                  ...asSection(values),
                  distributionBoardId: boardId,
                  position: nextPosition(sections),
                })
              : await client.update('board_sections', sectionId, asSection(values))

          if (result.outcome === 'queued') {
            onClose()
          }

          return result
        }}
        extraAction={
          sectionId !== null && keeps ? (
            <RemovePlace
              label="Entfernen"
              question={`„${name}“ entfernen?`}
              disabled={false}
              remove={() => client.remove('board_sections', sectionId)}
              onRemoved={onClose}
            >
              {circuits === 0
                ? 'Das Feld ist leer, es geht nichts mit.'
                : `Mit dem Feld gehen ${circuitsInWords(circuits)} samt ihren Betriebsmitteln.`}
            </RemovePlace>
          ) : undefined
        }
      />
    </Dialog>
  )
}

/** The circuits of a board in one place: a section, or the board directly. */
function inSection(circuits: readonly RecordState[], section: string | null) {
  return ordered(circuits.filter((circuit) => maybeText(circuit, 'boardSectionId') === section))
}

/**
 * A circuit added to a board or changed, the dialog of the board "Stromkreis
 * bearbeiten" with the form of the foundation: for "Stromkreis hinzufügen"
 * empty and with the section it was opened from, at the end of that section.
 * A circuit moved to another section in the form goes to the end of that
 * one, rather than keeping a number that means a place in the one it left.
 *
 * "Entfernen" stands at the left of the buttons, as the board draws it; the
 * form of the foundation has no place for a further action of its own, so
 * it stands beside the form, from the width of a tablet at the foot of it.
 */
export function CircuitDialog({
  board,
  sub,
  circuit,
  section = null,
  sections,
  circuits,
  equipment = 0,
  onClose,
  onMade,
  onRemoved,
}: {
  readonly board: RecordState
  /** The board and its asset, under the heading. */
  readonly sub: string
  readonly circuit?: RecordState | null
  /** The section a new circuit starts in, none for the board directly. */
  readonly section?: string | null
  readonly sections: readonly RecordState[]
  /** Every circuit of the board, for the place of a new one. */
  readonly circuits: readonly RecordState[]
  /** How much equipment hangs on the circuit, for the question before it goes. */
  readonly equipment?: number
  readonly onClose: () => void
  readonly onMade?: (id: string) => void | Promise<void>
  readonly onRemoved?: () => void | Promise<void>
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const boardId = String(board['id'])
  const circuitId = circuit ? String(circuit['id']) : null
  const known = new Set(sections.map((each) => String(each['id'])))

  /** The section the values name, none where it is the board itself or one this device lost. */
  const sectionOf = (values: Draft | RecordState | null | undefined): string | null => {
    const value = values?.['boardSectionId']

    return typeof value === 'string' && known.has(value) ? value : null
  }

  async function submit(values: Draft): Promise<EditResult> {
    const target = sectionOf(values)
    const others = circuits.filter((each) => String(each['id']) !== circuitId)
    const result =
      circuitId === null
        ? await client.create('circuits', {
            ...values,
            distributionBoardId: boardId,
            position: nextPosition(inSection(others, target)),
          })
        : await client.update('circuits', circuitId, {
            ...values,
            ...(sectionOf(circuit) === target
              ? {}
              : { position: nextPosition(inSection(others, target)) }),
          })

    if (result.outcome === 'queued') {
      onClose()

      if (circuitId === null) {
        await onMade?.(result.id)
      }
    }

    return result
  }

  return (
    <Dialog
      title={circuit ? `${circuitTitle(circuit)} bearbeiten` : 'Stromkreis hinzufügen'}
      sub={sub}
      width={640}
      onClose={onClose}
    >
      <div className="relative flex flex-col gap-3">
        <CircuitForm
          key={circuitId ?? `new-${boardId}-${section ?? ''}`}
          record={circuit ?? null}
          sections={sections}
          section={section}
          submitLabel={circuitId === null ? 'Hinzufügen' : 'Speichern'}
          onCancel={onClose}
          onSubmit={submit}
        />
        {circuitId !== null && keeps ? (
          <div className="flex flex-wrap items-center gap-2 sm:absolute sm:bottom-0 sm:left-0">
            <RemovePlace
              label="Entfernen"
              question={`„${circuitTitle(circuit as RecordState)}“ entfernen?`}
              disabled={false}
              remove={() => client.remove('circuits', circuitId)}
              onRemoved={async () => {
                onClose()
                await onRemoved?.()
              }}
            >
              {equipment === 0
                ? 'Am Stromkreis hängt kein Betriebsmittel, es geht nichts mit.'
                : `Mit dem Stromkreis gehen ${String(equipment)} Betriebsmittel.`}
            </RemovePlace>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

/** A piece of equipment added to a circuit, at its end, or changed. */
export function EquipmentDialog({
  circuit,
  sub,
  item,
  equipment,
  onClose,
}: {
  readonly circuit: RecordState
  /** The circuit and its board, under the heading. */
  readonly sub: string
  readonly item?: RecordState | null
  /** Every piece of equipment of the circuit, in order. */
  readonly equipment: readonly RecordState[]
  readonly onClose: () => void
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const circuitId = String(circuit['id'])
  const itemId = item ? String(item['id']) : null
  const name = text(item, 'designation')

  return (
    <Dialog
      title={itemId === null ? 'Betriebsmittel hinzufügen' : `${name} bearbeiten`}
      sub={sub}
      width={600}
      onClose={onClose}
    >
      <RecordForm
        key={itemId ?? `new-${circuitId}`}
        fields={equipmentFields}
        record={item ?? null}
        starred
        submitLabel={itemId === null ? 'Hinzufügen' : 'Speichern'}
        onCancel={onClose}
        onSubmit={async (values) => {
          const result =
            itemId === null
              ? await client.create('equipment', {
                  ...asEquipment(values),
                  circuitId,
                  position: nextPosition(equipment),
                })
              : await client.update('equipment', itemId, asEquipment(values))

          if (result.outcome === 'queued') {
            onClose()
          }

          return result
        }}
        extraAction={
          itemId !== null && keeps ? (
            <RemovePlace
              label="Entfernen"
              question={`„${name}“ entfernen?`}
              disabled={false}
              remove={() => client.remove('equipment', itemId)}
              onRemoved={onClose}
            >
              {`Es steht danach nicht mehr am Stromkreis ${text(circuit, 'designation')}.`}
            </RemovePlace>
          ) : undefined
        }
      />
    </Dialog>
  )
}
