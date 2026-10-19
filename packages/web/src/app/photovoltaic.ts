import type { RecordState } from '@opengewerk/haustechnik-domain'
import {
  inverterFields,
  inverterPower,
  makeAndModel,
  type PvField,
  useInvertersOf,
} from '@opengewerk/platform-web/electrical'
import { maybeText } from '@opengewerk/platform-web/sync'

/**
 * The PV structure below a PV installation (#461), as this application binds
 * it. The forms and parts are the foundation's (ADR 0014 in the repository
 * opengewerk) and come from here as well, so that a screen asks one module;
 * what is this application's is that an inverter hangs on an asset of one
 * kind and says where it hangs, where its pages are, and the words both
 * entries say about it.
 */
export * from '@opengewerk/platform-web/electrical'
export {
  holdsInverters,
  installationPeakText,
  pvPlaces,
  useInstallationModules,
  useInstallationPeak,
} from './pv-power.js'

/** The inverters of an asset, in their order. */
export function useInverters(assetId: string | undefined) {
  return useInvertersOf('assetId', assetId)
}

/**
 * The fields of an inverter: the foundation's, and beside the designation
 * where it hangs, which this application asks so that somebody finds it.
 */
export const inverterFieldsHere: readonly PvField[] = [
  ...inverterFields.slice(0, 1),
  { name: 'location', label: 'Ort', hint: 'Wo er hängt, damit ihn jemand findet.' },
  ...inverterFields.slice(1),
]

/** What both entries say about the structure, so that an inverter reads the same on both. */
export const pvWords = {
  noInverters: 'Noch kein Wechselrichter an dieser Anlage.',
  noStrings: 'Für diesen Wechselrichter ist noch kein String erfasst.',
  noModules: 'In diesem String ist noch kein Modul.',
  summed: 'Die Leistung der Anlage zählt die Module aller Wechselrichter zusammen.',
  likeTheLast: 'Hersteller, Modell und Leistung wie beim letzten Modul des Strings.',
  readOnSite: 'Vor Ort liest die App die Seriennummer vom Code auf dem Etikett.',
  withoutSerial: 'Ohne Seriennummer',
  saved: 'Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.',
  mayNot: 'Anlagen aufnehmen gehört nicht zu den Rechten dieses Zugangs.',
} as const

/** "Beispielwandler BW 10.0, 10,0 kW": what an inverter is, under its designation. */
export function inverterWhat(inverter: RecordState): string {
  return [makeAndModel(inverter), inverterPower(inverter)]
    .filter((part): part is string => part !== null)
    .join(', ')
}

/** Where an inverter hangs, or null where nobody wrote it down. */
export function inverterWhere(inverter: RecordState | null | undefined): string | null {
  return maybeText(inverter, 'location')
}
