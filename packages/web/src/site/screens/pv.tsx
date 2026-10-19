import {
  inverterProblems,
  labelCodeFromScan,
  modulePowerText,
  pvModuleProblems,
  pvStringProblems,
  type RecordState,
  serialFromCode,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, IconButton, Panel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import {
  NotSent,
  type SiteFact,
  SiteActionBar,
  SiteCrumbs,
  SiteFacts,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import {
  type Draft,
  type EditResult,
  maybeText,
  refusalFor,
  text,
  useRecord,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check, Pencil, Plus, ScanLine } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'

import {
  azimuthOf,
  batchStart,
  figureOf,
  inputOf,
  inverterFieldsHere,
  makeAndModel,
  modulesPowerText,
  nextPosition,
  PvForm,
  pvPlaces,
  pvWords,
  readFigure,
  stringFields,
  tiltOf,
  useInverters,
  usePvModules,
  usePvStrings,
} from '../../app/photovoltaic.js'
import { NotOnDevice } from '../kit.js'
import { sitePlaces, sitePv, stockTaking } from '../places.js'
import { SerialReader } from '../serial-reader.js'
import { FormButton } from './boards-block.js'
import { NotTaking, useAssetAbove } from './boards.js'

/**
 * The PV structure of a PV installation on site (#461, the boards "String mit
 * seinen Modulen" and "Modul hinzufügen"): a string with what is known about
 * it and its modules as cards in the order they were taken up, and the forms
 * that add and change an inverter, a string and a module. The inverters stand
 * on the page of the installation (`inverters-block.tsx`); these pages are
 * fetched when their address is opened (`router.tsx`).
 *
 * A technician on the roof takes the structure up without a network, like
 * everything here: whoever takes stock of assets adds and changes, and the
 * outbox carries it to the server with the next exchange. The serial number
 * of a module comes from the code on its label, read by the camera of the
 * device, which needs no network either. Nothing is removed on site; that is
 * the office's, for whoever keeps the assets.
 */

export const sitePvWords = {
  scanWithoutNetwork: 'Das Scannen geht auch ohne Netz: die Kamera liest den Code auf dem Gerät.',
  serialHint: 'Groß und klein wie auf dem Etikett.',
  serialRead: 'Vom Code auf dem Etikett gelesen. Groß und klein wie auf dem Etikett.',
  holdTheLabel: 'Halten Sie den Code auf dem Etikett des Moduls in den Rahmen.',
  inTakingOrder: 'in der Reihenfolge der Aufnahme',
  check: 'Nicht gespeichert. Bitte die markierten Felder ansehen.',
  notKept: 'Auf diesem Gerät ließ sich das nicht speichern. Die Eingaben stehen noch da.',
} as const

const moduleCameraWords = {
  noReader: 'Dieses Gerät liest keine Codes. Die Seriennummer lässt sich von Hand eintragen.',
  noCamera:
    'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Die Seriennummer lässt sich von Hand eintragen.',
}

/**
 * The serial number in what the code on the label of a module says: a label
 * of this application is none, and neither is a text longer than a serial
 * number, as a code with an address in it would be.
 */
export function moduleSerialFromCode(code: string): string | null {
  return labelCodeFromScan(code.trim()) === null ? serialFromCode(code) : null
}

/** The inverter of the address, if it hangs on the asset of the address. */
function useInverterOf(assetId: string | undefined, inverterId: string | undefined) {
  const inverter = useRecord('inverters', inverterId)

  return inverter !== null && maybeText(inverter, 'assetId') === assetId ? inverter : null
}

/** The string of the address, if it is one of the inverter of the address. */
function useStringOf(inverterId: string | undefined, stringId: string | undefined) {
  const pvString = useRecord('pv_strings', stringId)

  return pvString !== null && maybeText(pvString, 'inverterId') === inverterId ? pvString : null
}

/** The way back to the page of the asset, or to "Aufnehmen" without one. */
function backToAsset(assetId: string | undefined) {
  return assetId === undefined
    ? { to: stockTaking.start, label: 'Zurück zu Aufnehmen' }
    : { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
}

/** What is known about a string, only what somebody entered and what its modules add up to. */
function stringFacts(
  pvString: RecordState,
  inverter: RecordState,
  modules: readonly RecordState[],
): readonly SiteFact[] {
  return [
    { label: 'MPP-Eingang', value: inputOf(pvString, inverter) ?? '' },
    { label: 'Module', value: modulesPowerText(modules) },
    { label: 'Ausrichtung', value: azimuthOf(pvString) ?? '' },
    { label: 'Neigung', value: tiltOf(pvString) ?? '' },
  ].filter((fact) => fact.value !== '')
}

/** "Beispielsolar BS 400 M, 400 Wp": what a module is, under its serial number. */
function moduleLine(module: RecordState): string {
  const watts = figureOf(module, 'ratedPowerW')

  return [makeAndModel(module), watts === null ? null : modulePowerText(watts)]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/**
 * One string on site, the board "String mit seinen Modulen": what is known of
 * it with the way to change it, and its modules as cards in the order they
 * were taken up, each with its place, its serial number, which is what tells
 * it apart on the roof, and its pencil. "Modul hinzufügen" stands at the foot
 * of the screen, where the thumb is.
 */
export function SiteStringScreen() {
  const { assetId, inverterId, stringId } = useParams({ strict: false }) as {
    assetId?: string
    inverterId?: string
    stringId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset, path } = useAssetAbove(assetId)
  const inverter = useInverterOf(assetId, inverterId)
  const pvString = useStringOf(inverterId, stringId)
  const modules = usePvModules(pvString ? stringId : undefined)

  if (
    !pvString ||
    !inverter ||
    !asset ||
    assetId === undefined ||
    inverterId === undefined ||
    stringId === undefined
  ) {
    return <NotOnDevice what="Diesen String" back={backToAsset(assetId)} />
  }

  const assetName = text(asset, 'name')

  return (
    <>
      <SiteHeader
        title={text(pvString, 'designation')}
        sub={`${text(inverter, 'designation')}, ${assetName}`}
        back={{ to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }}
      />
      <SiteScreen gap={10}>
        {/* The path ends at the installation already, as on the pages of a board. */}
        {path.length > 0 ? <SiteCrumbs items={path} /> : null}
        <Panel title="Angaben">
          <div className="flex flex-col gap-3">
            <SiteFacts facts={stringFacts(pvString, inverter, modules)} />
            {records ? (
              <FormButton to={sitePv.editString(assetId, inverterId, stringId)} icon={Pencil}>
                Bearbeiten
              </FormButton>
            ) : null}
          </div>
        </Panel>
        <div className="mt-1.5 flex items-baseline gap-2">
          <h2 className="text-[19px] font-bold">Module</h2>
          {modules.length === 0 ? null : (
            <span className="text-[15px] text-ink-muted">
              {`${String(modules.length)}, ${sitePvWords.inTakingOrder}`}
            </span>
          )}
        </div>
        {modules.length === 0 ? (
          <SiteText muted>{pvWords.noModules}</SiteText>
        ) : (
          <ul aria-label="Module" className="flex flex-col gap-2.5">
            {modules.map((module, index) => {
              const id = String(module['id'])
              const serial = maybeText(module, 'serialNumber')
              const place = index + 1
              const line = moduleLine(module)

              return (
                <li
                  key={id}
                  className="flex min-h-16 items-center gap-2.5 rounded-[6px] border border-line bg-surface py-2 pr-1 pl-3"
                >
                  <span className="min-w-[26px] shrink-0 rounded-[4px] bg-top px-2 py-[3px] text-center font-condensed text-[17px] font-semibold text-top-ink">
                    {place}
                  </span>{' '}
                  <span className="min-w-0 grow">
                    <span
                      className={`block text-[17px] font-semibold [overflow-wrap:anywhere] ${serial === null ? 'text-waiting' : ''}`}
                    >
                      {serial === null ? pvWords.withoutSerial : `SN ${serial}`}
                    </span>
                    <span className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted">
                      {line}
                      {client.isPending('pv_modules', id) ? (
                        <>
                          {line === '' ? null : ', '}
                          <NotSent />
                        </>
                      ) : null}
                    </span>
                  </span>
                  {records ? (
                    <IconButton
                      label={`Modul ${String(place)} bearbeiten`}
                      onClick={() => {
                        void navigate({
                          to: sitePv.editModule(assetId, inverterId, stringId, id),
                        })
                      }}
                    >
                      <Pencil size={20} strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </SiteScreen>
      {records ? (
        <SiteActionBar>
          <Button
            tone="primary"
            wide
            icon={Plus}
            onClick={() => {
              void navigate({ to: sitePv.newModule(assetId, inverterId, stringId) })
            }}
          >
            Modul hinzufügen
          </Button>
        </SiteActionBar>
      ) : null}
    </>
  )
}

/** An inverter added to the asset of the address, or the inverter of the address changed. */
export function SiteInverterFormScreen() {
  const { assetId, inverterId } = useParams({ strict: false }) as {
    assetId?: string
    inverterId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const inverters = useInverters(assetId)
  const inverter = useInverterOf(assetId, inverterId)
  const editing = inverterId !== undefined

  if (!asset || assetId === undefined || (editing && !inverter)) {
    return (
      <NotOnDevice
        what={editing ? 'Diesen Wechselrichter' : 'Diese Anlage'}
        back={backToAsset(assetId)}
      />
    )
  }

  const back = { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
  const title = editing
    ? `${text(inverter, 'designation')} bearbeiten`
    : 'Wechselrichter hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  async function submit(values: Draft): Promise<EditResult> {
    const result =
      inverterId === undefined
        ? await client.create('inverters', {
            ...values,
            assetId,
            position: nextPosition(inverters),
          })
        : await client.update('inverters', inverterId, values)

    if (result.outcome === 'queued') {
      await navigate({ to: back.to })
    }

    return result
  }

  return (
    <>
      <SiteHeader title={title} sub={text(asset, 'name')} back={back} />
      <SiteScreen>
        <PvForm
          key={inverterId ?? `new-${assetId}`}
          fields={inverterFieldsHere}
          record={inverter}
          rules={inverterProblems}
          note={() => pvWords.saved}
          submitLabel={editing ? 'Speichern' : 'Hinzufügen'}
          onCancel={() => {
            void navigate({ to: back.to })
          }}
          onSubmit={submit}
        />
      </SiteScreen>
    </>
  )
}

/**
 * A string added to the inverter of the address, or the string of the address
 * changed. A new one goes to the end of the strings of its inverter, and its
 * page opens, where its modules are taken up next.
 */
export function SiteStringFormScreen() {
  const { assetId, inverterId, stringId } = useParams({ strict: false }) as {
    assetId?: string
    inverterId?: string
    stringId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const inverter = useInverterOf(assetId, inverterId)
  const strings = usePvStrings(inverter ? inverterId : undefined)
  const pvString = useStringOf(inverterId, stringId)
  const editing = stringId !== undefined

  if (
    !asset ||
    !inverter ||
    assetId === undefined ||
    inverterId === undefined ||
    (editing && !pvString)
  ) {
    return (
      <NotOnDevice
        what={editing ? 'Diesen String' : 'Diesen Wechselrichter'}
        back={backToAsset(assetId)}
      />
    )
  }

  const back =
    stringId === undefined
      ? { to: sitePlaces.asset(assetId), label: 'Zurück zur Anlage' }
      : { to: pvPlaces.string(assetId, inverterId, stringId), label: 'Zurück zum String' }
  const title = editing ? `${text(pvString, 'designation')} bearbeiten` : 'String hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  async function submit(values: Draft): Promise<EditResult> {
    const result =
      stringId === undefined
        ? await client.create('pv_strings', {
            ...values,
            inverterId,
            position: nextPosition(strings),
          })
        : await client.update('pv_strings', stringId, values)

    if (result.outcome === 'queued' && assetId !== undefined && inverterId !== undefined) {
      await navigate({ to: pvPlaces.string(assetId, inverterId, result.id) })
    }

    return result
  }

  return (
    <>
      <SiteHeader
        title={title}
        sub={`${text(inverter, 'designation')}, ${text(asset, 'name')}`}
        back={back}
      />
      <SiteScreen>
        <PvForm
          key={stringId ?? `new-${inverterId}`}
          fields={stringFields(inverter, pvString)}
          record={pvString}
          rules={pvStringProblems}
          note={() => pvWords.saved}
          submitLabel={editing ? 'Speichern' : 'Hinzufügen'}
          onCancel={() => {
            void navigate({ to: back.to })
          }}
          onSubmit={submit}
        />
      </SiteScreen>
    </>
  )
}

/** What the form of a module holds while somebody types, as text. */
interface TypedModule {
  readonly manufacturer: string
  readonly model: string
  readonly serialNumber: string
  readonly ratedPowerW: string
}

function typedFrom(record: RecordState): TypedModule {
  const watts = figureOf(record, 'ratedPowerW')

  return {
    manufacturer: maybeText(record, 'manufacturer') ?? '',
    model: maybeText(record, 'model') ?? '',
    serialNumber: maybeText(record, 'serialNumber') ?? '',
    ratedPowerW: watts === null ? '' : String(watts),
  }
}

/** What was typed, as the module keeps it, and what is wrong with any field. */
function readModule(typed: TypedModule): {
  readonly values: Draft
  readonly problems: Readonly<Record<string, string>>
} {
  const power = readFigure(typed.ratedPowerW, 0, ['Wp'])
  const trimmed = (value: string) => (value.trim() === '' ? null : value.trim())
  const values: Draft = {
    manufacturer: trimmed(typed.manufacturer),
    model: trimmed(typed.model),
    serialNumber: trimmed(typed.serialNumber),
    ratedPowerW: 'value' in power ? power.value : null,
  }

  return {
    values,
    problems: {
      ...('problem' in power ? { ratedPowerW: power.problem } : {}),
      ...pvModuleProblems(values),
    },
  }
}

/**
 * A module added to the string of the address, the board "Modul hinzufügen",
 * or the module of the address changed in the same form, filled in. A new one
 * starts with maker, model and power of the last module of its string and
 * goes to its end.
 *
 * "Seriennummer scannen" opens the camera with the tap and never by itself;
 * it reads the code on the label of the module and puts the number into the
 * field, which may be typed as well. The camera stands in place of the form
 * while it reads, and what was typed stays.
 */
export function SiteModuleFormScreen() {
  const { assetId, inverterId, stringId, moduleId } = useParams({ strict: false }) as {
    assetId?: string
    inverterId?: string
    stringId?: string
    moduleId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const records = useRight('asset.record')
  const { asset } = useAssetAbove(assetId)
  const inverter = useInverterOf(assetId, inverterId)
  const pvString = useStringOf(inverterId, stringId)
  const modules = usePvModules(pvString ? stringId : undefined)
  const item = modules.find((each) => String(each['id']) === moduleId) ?? null
  const editing = moduleId !== undefined

  if (
    !asset ||
    !inverter ||
    !pvString ||
    assetId === undefined ||
    inverterId === undefined ||
    stringId === undefined ||
    (editing && !item)
  ) {
    return (
      <NotOnDevice what={editing ? 'Dieses Modul' : 'Diesen String'} back={backToAsset(assetId)} />
    )
  }

  const back = { to: pvPlaces.string(assetId, inverterId, stringId), label: 'Zurück zum String' }
  const title = editing
    ? `Modul ${String(modules.indexOf(item as RecordState) + 1)} bearbeiten`
    : 'Modul hinzufügen'

  if (!records) {
    return <NotTaking title={title} back={back} />
  }

  return (
    <ModuleForm
      key={moduleId ?? `new-${stringId}`}
      title={title}
      sub={`${text(pvString, 'designation')}, ${text(inverter, 'designation')}`}
      start={item ?? batchStart(modules)}
      editing={editing}
      back={back}
      onCancel={() => {
        void navigate({ to: back.to })
      }}
      onSubmit={async (values) => {
        const result =
          moduleId === undefined
            ? await client.create('pv_modules', {
                ...values,
                pvStringId: stringId,
                position: nextPosition(modules),
              })
            : await client.update('pv_modules', moduleId, values)

        if (result.outcome === 'queued') {
          await navigate({ to: back.to })
        }

        return result
      }}
    />
  )
}

/** The form of a module on site, with the camera on the code of its label. */
function ModuleForm({
  title,
  sub,
  start,
  editing,
  back,
  onCancel,
  onSubmit,
}: {
  readonly title: string
  readonly sub: string
  /** What the fields start with: the module, or for a new one the last of its string. */
  readonly start: RecordState
  readonly editing: boolean
  readonly back: { readonly to: string; readonly label: string }
  readonly onCancel: () => void
  readonly onSubmit: (values: Draft) => Promise<EditResult>
}) {
  const formId = useId()
  const [typed, setTyped] = useState<TypedModule>(() => typedFrom(start))
  const [reading, setReading] = useState(false)
  // The reader stands in place of the form, so the form comes back anew when
  // it closes; its field takes the focus then, as at an asset (#132).
  const [readerClosed, setReaderClosed] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const set = (values: Partial<TypedModule>) => {
    setTyped((current) => ({ ...current, ...values }))
  }

  if (reading) {
    return (
      <SerialReader
        sub={sub}
        hint={sitePvWords.holdTheLabel}
        words={moduleCameraWords}
        accept={moduleSerialFromCode}
        onTake={(serialNumber) => {
          set({ serialNumber })
          setScanned(true)
          setReading(false)
          setReaderClosed(true)
        }}
        onClose={() => {
          setReading(false)
          setReaderClosed(true)
        }}
      />
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()

    // One press is one write.
    if (working) {
      return
    }

    setTrouble(null)

    const read = readModule(typed)

    setProblems(read.problems)

    if (Object.keys(read.problems).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await onSubmit(read.values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      }
    } catch {
      setTrouble(sitePvWords.notKept)
    } finally {
      setWorking(false)
    }
  }

  const problemOf = (field: string) =>
    problems[field] === undefined ? {} : { problem: problems[field] }

  return (
    <>
      <SiteHeader title={title} sub={sub} back={back} />
      <SiteScreen>
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-3.5"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          <Field
            label="Hersteller"
            value={typed.manufacturer}
            {...problemOf('manufacturer')}
            onChange={(event) => {
              set({ manufacturer: event.target.value })
            }}
          />
          <Field
            label="Modell"
            value={typed.model}
            {...problemOf('model')}
            onChange={(event) => {
              set({ model: event.target.value })
            }}
          />
          <div className="flex flex-col gap-2.5">
            <Button
              wide
              height={52}
              icon={ScanLine}
              onClick={() => {
                setReading(true)
              }}
            >
              Seriennummer scannen
            </Button>
            <Field
              label="Seriennummer"
              value={typed.serialNumber}
              autoFocus={readerClosed}
              hint={scanned ? sitePvWords.serialRead : sitePvWords.serialHint}
              {...problemOf('serialNumber')}
              onChange={(event) => {
                set({ serialNumber: event.target.value })
                setScanned(false)
              }}
            />
          </div>
          <Field
            label="Leistung"
            unit="Wp"
            numeric
            inputMode="numeric"
            hint="Zum Beispiel 400."
            value={typed.ratedPowerW}
            {...problemOf('ratedPowerW')}
            onChange={(event) => {
              set({ ratedPowerW: event.target.value })
            }}
          />
          {editing ? null : (
            <SiteText muted size={15}>
              {pvWords.likeTheLast}
            </SiteText>
          )}
          <SiteText muted size={15}>
            {sitePvWords.scanWithoutNetwork}
          </SiteText>
          <SiteText muted size={15}>
            {pvWords.saved}
          </SiteText>
          {Object.keys(problems).length > 0 ? <SiteTrouble>{sitePvWords.check}</SiteTrouble> : null}
          {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
          <SiteActionBar>
            <Button wide className="flex-1 basis-0" onClick={onCancel} disabled={working}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              form={formId}
              tone="primary"
              wide
              icon={Check}
              className="flex-2 basis-0"
              disabled={working}
            >
              {working ? 'Wird gespeichert' : editing ? 'Speichern' : 'Hinzufügen'}
            </Button>
          </SiteActionBar>
        </form>
      </SiteScreen>
    </>
  )
}
