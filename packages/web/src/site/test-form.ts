import {
  blockFieldKinds,
  type CatalogueBundle,
  type CatalogueRule,
  type PackagedForm,
} from '@opengewerk/haustechnik-domain'

import { acceptedReview, testCatalogue } from '../app/test-catalogue.js'
import { boilerRoom, heater, school } from './test-site.js'

/**
 * What the tests of a form on site share (#107): a form with a field of
 * every kind the forms of this application have, a measured value against a
 * rule among them and a repeating group, in a catalogue beside the probe
 * package, and an activity at the boiler room that is filled in with it.
 */

export const technicalRoom: PackagedForm = {
  title: 'Rundgang durch den Heizraum',
  sections: [
    {
      key: 'boiler_room',
      title: 'Heizraum E.14',
      fields: [
        {
          kind: 'measurement',
          key: 'outlet',
          label: 'Temperatur am Speicheraustritt',
          unit: 'degrees_celsius',
          decimals: 1,
          required: true,
          limit: { kind: 'at_least', rule: 'probe.hot_water_minimum' },
          about: { kind: 'asset', id: heater.id },
        },
        { kind: 'check_point', key: 'door_closes', label: 'Tür schließt selbsttätig' },
        {
          kind: 'meter_reading',
          key: 'heat_meter',
          label: 'Wärmemengenzähler Schulhaus',
          unit: 'megawatt_hours',
          decimals: 2,
          required: true,
        },
        {
          kind: 'number',
          key: 'refilled',
          label: 'Nachgefülltes Wasser',
          unit: 'cubic_metres',
          decimals: 3,
        },
        {
          kind: 'choice',
          key: 'burner',
          label: 'Zustand des Brenners',
          options: [
            { value: 'running', label: 'läuft' },
            { value: 'standby', label: 'Bereitschaft' },
            { value: 'fault', label: 'Störung' },
          ],
        },
        { kind: 'yes_no', key: 'log_book', label: 'Betriebsbuch liegt aus' },
        { kind: 'photo', key: 'displays', label: 'Foto der Anzeigen am Kessel' },
        { kind: 'text', key: 'noticed', label: 'Sonst aufgefallen', multiline: true },
      ],
    },
    {
      key: 'lights',
      title: 'Sicherheitsleuchten',
      fields: [
        {
          kind: 'group',
          key: 'lights',
          label: 'Leuchte',
          repeat: 'free',
          fields: [{ kind: 'check_point', key: 'lights_up', label: 'Leuchtet im Batteriebetrieb' }],
        },
      ],
    },
    {
      key: 'end',
      title: 'Abschluss',
      fields: [{ kind: 'signature', key: 'signature', label: 'Unterschrift', seals: true }],
    },
  ],
}

/** The kinds the form above holds, which have to be every kind there is. */
export const kindsInTheForm = blockFieldKinds.filter((kind) =>
  technicalRoom.sections.some((section) =>
    section.fields.some(
      (field) =>
        field.kind === kind ||
        (field.kind === 'group' && field.fields.some((nested) => nested.kind === kind)),
    ),
  ),
)

const hotWater: CatalogueRule = {
  record: {
    key: 'probe.hot_water_minimum',
    validFrom: '2015-06-01',
    validUntil: null,
    unit: 'decidegrees_celsius',
    value: 600,
    source: 'DVGW-Arbeitsblatt W 551',
    origin: 'private_standard',
  },
  review: acceptedReview,
}

/** The probe catalogue with the form and its rule. */
export const formCatalogue: CatalogueBundle = {
  ...testCatalogue,
  sha256: '2'.repeat(64),
  packages: testCatalogue.packages.map((each, index) =>
    index === 0
      ? {
          ...each,
          forms: [
            ...each.forms,
            {
              key: 'probe.technical_room',
              version: 1,
              validFrom: '2018-03-01',
              definition: technicalRoom,
              review: acceptedReview,
            },
          ],
          rules: [...each.rules, hotWater],
        }
      : each,
  ),
}

/** A round through the boiler room, open, on the device of whoever performs it. */
export const round = {
  id: 'ac-round',
  propertyId: school.id,
  areaId: school.areaId,
  roomId: boilerRoom.id,
  kind: 'inspection',
  status: 'open',
  title: 'Rundgang durch den Heizraum',
  formKey: 'probe.technical_room',
  formVersion: 1,
  performedOn: null,
  dueOn: '2026-10-09',
}
