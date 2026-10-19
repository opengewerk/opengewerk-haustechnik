import {
  inverterProblems,
  pvModuleProblems,
  pvStringProblems,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Dialog } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import {
  type Draft,
  type EditResult,
  maybeText,
  text,
  useSync,
} from '@opengewerk/platform-web/sync'
import { type ReactNode } from 'react'

import {
  batchStart,
  inverterFieldsHere,
  moduleFields,
  modulesInWords,
  nextPosition,
  PvForm,
  pvWords,
  stringFields,
  stringsInWords,
} from '../app/photovoltaic.js'
import { RemovePlace } from './place-forms.js'

/**
 * The dialogs of the PV structure in the office (#461): an inverter, a string
 * and a module, each added and changed over the page it belongs to, with the
 * forms of the foundation. The inverter and the module are the dialogs of the
 * boards "Wechselrichter hinzufügen" and "Modul hinzufügen"; the string is not
 * drawn and stands in the same frame with the fields the foundation names for
 * it. Everything is written through the outbox, so the structure is taken up
 * without a network as well. Adding and changing is for whoever takes stock of
 * assets, and the screens offer these dialogs to nobody else; only
 * "Entfernen" asks for the right to keep them, and is missing without it.
 *
 * The form of the foundation has no place for a further action of its own, so
 * "Entfernen" stands beside it, from the width of a tablet at the left of its
 * buttons, as at a circuit (#349).
 */

/** "Entfernen" at the foot of a dialog, for whoever keeps the assets. */
function Removing({
  name,
  remove,
  onRemoved,
  children,
}: {
  readonly name: string
  readonly remove: () => Promise<EditResult>
  readonly onRemoved: () => void | Promise<void>
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:absolute sm:bottom-0 sm:left-0">
      <RemovePlace
        label="Entfernen"
        question={`„${name}“ entfernen?`}
        disabled={false}
        remove={remove}
        onRemoved={onRemoved}
      >
        {children}
      </RemovePlace>
    </div>
  )
}

/** What goes with an inverter that is removed, in words. */
function inverterContents(strings: number, modules: number): string {
  if (strings === 0) {
    return 'Der Wechselrichter hat keinen String, es geht nichts mit.'
  }

  return modules === 0
    ? `Mit dem Wechselrichter gehen ${stringsInWords(strings)}.`
    : `Mit dem Wechselrichter gehen ${stringsInWords(strings)} und ${modulesInWords(modules)}.`
}

/** An inverter added to a PV installation, at the end of its list, or changed. */
export function InverterDialog({
  assetId,
  assetName,
  inverter,
  inverters,
  strings = 0,
  modules = 0,
  onClose,
  onRemoved,
}: {
  readonly assetId: string
  /** The asset by its name, under the heading. */
  readonly assetName: string
  /** The inverter to change; none for a new one. */
  readonly inverter?: RecordState | null
  /** Every inverter of the asset, in order. */
  readonly inverters: readonly RecordState[]
  /** How many strings and modules the inverter has, for the question before it goes. */
  readonly strings?: number
  readonly modules?: number
  readonly onClose: () => void
  readonly onRemoved?: () => void | Promise<void>
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const inverterId = inverter ? String(inverter['id']) : null
  const name = text(inverter, 'designation')

  async function submit(values: Draft): Promise<EditResult> {
    const result =
      inverterId === null
        ? await client.create('inverters', {
            ...values,
            assetId,
            position: nextPosition(inverters),
          })
        : await client.update('inverters', inverterId, values)

    if (result.outcome === 'queued') {
      onClose()
    }

    return result
  }

  return (
    <Dialog
      title={inverterId === null ? 'Wechselrichter hinzufügen' : `${name} bearbeiten`}
      sub={assetName}
      width={640}
      onClose={onClose}
    >
      <div className="relative flex flex-col gap-3">
        <PvForm
          key={inverterId ?? `new-${assetId}`}
          fields={inverterFieldsHere}
          record={inverter ?? null}
          rules={inverterProblems}
          submitLabel={inverterId === null ? 'Hinzufügen' : 'Speichern'}
          onCancel={onClose}
          onSubmit={submit}
        />
        {inverterId !== null && keeps ? (
          <Removing
            name={name}
            remove={() => client.remove('inverters', inverterId)}
            onRemoved={async () => {
              onClose()
              await onRemoved?.()
            }}
          >
            {inverterContents(strings, modules)}
          </Removing>
        ) : null}
      </div>
    </Dialog>
  )
}

/** A string added to an inverter, at its end, or changed. */
export function StringDialog({
  inverter,
  sub,
  pvString,
  strings,
  modules = 0,
  onClose,
}: {
  readonly inverter: RecordState
  /** The inverter and its asset, under the heading. */
  readonly sub: string
  readonly pvString?: RecordState | null
  /** Every string of the inverter, in order. */
  readonly strings: readonly RecordState[]
  /** How many modules the string has, for the question before it goes. */
  readonly modules?: number
  readonly onClose: () => void
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const inverterId = String(inverter['id'])
  const stringId = pvString ? String(pvString['id']) : null
  const name = text(pvString, 'designation')

  async function submit(values: Draft): Promise<EditResult> {
    const result =
      stringId === null
        ? await client.create('pv_strings', {
            ...values,
            inverterId,
            position: nextPosition(strings),
          })
        : await client.update('pv_strings', stringId, values)

    if (result.outcome === 'queued') {
      onClose()
    }

    return result
  }

  return (
    <Dialog
      title={stringId === null ? 'String hinzufügen' : `${name} bearbeiten`}
      sub={sub}
      width={640}
      onClose={onClose}
    >
      <div className="relative flex flex-col gap-3">
        <PvForm
          key={stringId ?? `new-${inverterId}`}
          fields={stringFields(inverter, pvString)}
          record={pvString ?? null}
          rules={pvStringProblems}
          submitLabel={stringId === null ? 'Hinzufügen' : 'Speichern'}
          onCancel={onClose}
          onSubmit={submit}
        />
        {stringId !== null && keeps ? (
          <Removing
            name={name}
            remove={() => client.remove('pv_strings', stringId)}
            onRemoved={onClose}
          >
            {modules === 0
              ? 'Der String hat kein Modul, es geht nichts mit.'
              : `Mit dem String gehen ${modulesInWords(modules)}.`}
          </Removing>
        ) : null}
      </div>
    </Dialog>
  )
}

/**
 * A module added at the end of a string, the dialog of the board "Modul
 * hinzufügen", or changed. A new one starts with the maker, model and power
 * of the last module of its string, since a string is one kind of module
 * nearly always; its serial number is its own.
 */
export function ModuleDialog({
  pvString,
  sub,
  item,
  modules,
  onClose,
}: {
  readonly pvString: RecordState
  /** The string, its inverter and its asset, under the heading. */
  readonly sub: string
  readonly item?: RecordState | null
  /** Every module of the string, in order. */
  readonly modules: readonly RecordState[]
  readonly onClose: () => void
}) {
  const client = useSync()
  const keeps = useRight('asset.write')
  const stringId = String(pvString['id'])
  const itemId = item ? String(item['id']) : null
  const serial = maybeText(item, 'serialNumber')
  const name =
    itemId === null
      ? ''
      : `Modul ${String(modules.findIndex((each) => String(each['id']) === itemId) + 1)}`

  async function submit(values: Draft): Promise<EditResult> {
    const result =
      itemId === null
        ? await client.create('pv_modules', {
            ...values,
            pvStringId: stringId,
            position: nextPosition(modules),
          })
        : await client.update('pv_modules', itemId, values)

    if (result.outcome === 'queued') {
      onClose()
    }

    return result
  }

  return (
    <Dialog
      title={itemId === null ? 'Modul hinzufügen' : `${name} bearbeiten`}
      sub={sub}
      width={640}
      onClose={onClose}
    >
      <div className="relative flex flex-col gap-3">
        <PvForm
          key={itemId ?? `new-${stringId}`}
          fields={moduleFields}
          record={item ?? batchStart(modules)}
          rules={pvModuleProblems}
          note={itemId === null ? () => `${pvWords.likeTheLast} ${pvWords.readOnSite}` : undefined}
          submitLabel={itemId === null ? 'Hinzufügen' : 'Speichern'}
          onCancel={onClose}
          onSubmit={submit}
        />
        {itemId !== null && keeps ? (
          <Removing
            name={serial === null ? name : `${name}, SN ${serial}`}
            remove={() => client.remove('pv_modules', itemId)}
            onRemoved={onClose}
          >
            {`Es steht danach nicht mehr im ${text(pvString, 'designation')}.`}
          </Removing>
        ) : null}
      </div>
    </Dialog>
  )
}
