import {
  type AssetKind,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueFormat,
  type CatalogueReview,
  type CatalogueRule,
  type DutyKind,
  type PackagedForm,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'

/**
 * A catalogue for the tests of the screens: three packages nobody ships, with
 * every kind of entry and every state of a review. The first one is what a
 * screen shows by default; the second has nothing to accept, the third
 * nothing left to.
 *
 * "Recently" is today and "long ago" a day years back, so that the marks do
 * not depend on the day a test runs. A version that begins in the year 2999
 * is one that is never in force.
 */

/** Accepted, and checked against the source today. */
export const acceptedReview: CatalogueReview = {
  checkedOn: today(),
  accepted: { by: 'Ada Beispiel', on: '2026-01-15' },
}

/** Checked today, and nobody has accepted it. */
export const unacceptedReview: CatalogueReview = { checkedOn: today(), accepted: null }

/** Nobody has accepted it, and its last check lies years back. */
export const neglectedReview: CatalogueReview = { checkedOn: '2020-01-01', accepted: null }

function entry<Definition>(
  key: string,
  version: number,
  validFrom: string,
  definition: Definition,
  review: CatalogueReview,
): CatalogueEntry<Definition> {
  return { key, version, validFrom, definition, review }
}

function rule(
  record: Pick<CatalogueRule['record'], 'key' | 'validFrom' | 'validUntil' | 'unit' | 'value'>,
  review: CatalogueReview,
): CatalogueRule {
  return {
    record: { source: 'Anhang 2 der Probeverordnung', origin: 'state_law', ...record },
    review,
  }
}

const elevator: AssetKind = {
  label: 'Aufzugsanlage',
  costGroup: '461',
  characteristics: [{ key: 'firefighters_lift', label: 'Feuerwehraufzug', kind: 'flag' }],
  fields: [{ key: 'stops', label: 'Haltestellen', kind: 'number' }],
  expectedDocuments: [],
  meter: null,
}

const pump: AssetKind = {
  label: 'Druckerhöhungsanlage',
  costGroup: '412',
  characteristics: [],
  fields: [],
  expectedDocuments: [],
  meter: null,
}

export const mainTest: DutyKind = {
  label: 'Hauptprüfung der Aufzugsanlage',
  description: 'Eine zugelassene Überwachungsstelle prüft die Aufzugsanlage wiederkehrend.',
  task: 'inspection',
  origin: 'state_law',
  bindingness: 'statute',
  source: '§ 16 der Probeverordnung',
  interval: { kind: 'maximum', rule: 'probe.main_test_interval' },
  counting: 'betrsichv',
  qualification: { level: 'approved_body' },
  evidence: { kinds: ['report'] },
  retention: { kind: 'years', rule: 'probe.retention_years' },
  scope: {
    assetKinds: ['probe.elevator'],
    conditions: [{ characteristic: 'firefighters_lift', is: true }],
    buildingKinds: ['hospital'],
    states: ['DE-BW'],
  },
}

export const interimCheck: DutyKind = {
  label: 'Zwischenprüfung',
  description: 'Zwischen zwei Hauptprüfungen wird die Aufzugsanlage auf ihre Funktion geprüft.',
  task: 'function_check',
  origin: 'private_standard',
  bindingness: 'technical_rule',
  source: 'Probenorm 13015, Abschnitt 4',
  interval: { kind: 'none' },
  counting: 'from_performance',
  qualification: { level: 'competent_person', note: 'mit Erfahrung an Aufzügen' },
  evidence: { kinds: ['protocol', 'work_order'], form: 'probe.interim_protocol' },
  retention: { kind: 'until_next_inspection' },
  scope: { assetKinds: [], conditions: [], buildingKinds: [], states: [] },
}

const interimProtocol: PackagedForm = {
  title: 'Protokoll der Zwischenprüfung',
  sections: [{ key: 'car', title: 'Fahrkorb', fields: [] }],
}

const weeklyRound: PackagedForm = { title: 'Rundgang durch die Technikzentrale', sections: [] }

export const testCatalogue: CatalogueBundle = {
  format: catalogueFormat,
  sha256: '1'.repeat(64),
  packages: [
    {
      name: 'probe',
      title: 'Probepaket',
      version: '1.2.0',
      minimumCore: '0.1.0',
      assetKinds: [
        entry('probe.elevator', 1, '2015-06-01', elevator, acceptedReview),
        entry('probe.elevator', 2, '2999-01-01', { ...elevator, label: 'Aufzug' }, acceptedReview),
        entry('probe.pump', 1, '2015-06-01', pump, unacceptedReview),
      ],
      dutyKinds: [
        entry('probe.elevator_main_test', 1, '2015-06-01', mainTest, acceptedReview),
        entry('probe.interim_check', 1, '2018-03-01', interimCheck, neglectedReview),
      ],
      forms: [entry('probe.interim_protocol', 1, '2018-03-01', interimProtocol, unacceptedReview)],
      roundTemplates: [entry('probe.weekly_round', 1, '2018-03-01', weeklyRound, acceptedReview)],
      rules: [
        rule(
          {
            key: 'probe.main_test_interval',
            validFrom: '2015-06-01',
            validUntil: '2020-12-31',
            unit: 'months',
            value: 36,
          },
          acceptedReview,
        ),
        rule(
          {
            key: 'probe.main_test_interval',
            validFrom: '2021-01-01',
            validUntil: null,
            unit: 'months',
            value: 24,
          },
          acceptedReview,
        ),
        rule(
          {
            key: 'probe.retention_years',
            validFrom: '2015-06-01',
            validUntil: null,
            unit: 'years',
            value: 10,
          },
          neglectedReview,
        ),
      ],
      defectClasses: [
        {
          defectClass: {
            key: 'probe.slight',
            label: 'leicht',
            unsafe: false,
            source: 'Probenorm 13015, Abschnitt 7',
          },
          review: acceptedReview,
        },
        {
          defectClass: { key: 'probe.severe', label: 'schwer', unsafe: true, source: null },
          review: unacceptedReview,
        },
      ],
    },
    {
      name: 'leer',
      title: 'Leeres Paket',
      version: '1.0.0',
      minimumCore: '0.1.0',
      assetKinds: [],
      dutyKinds: [],
      forms: [],
      roundTemplates: [],
      rules: [],
      defectClasses: [],
    },
    {
      name: 'fertig',
      title: 'Abgenommenes Paket',
      version: '2.0.0',
      minimumCore: '0.1.0',
      assetKinds: [entry('fertig.pump', 1, '2015-06-01', pump, acceptedReview)],
      dutyKinds: [],
      forms: [],
      roundTemplates: [],
      rules: [],
      defectClasses: [],
    },
  ],
}

/** What a server with this catalogue answers the two questions of a device with. */
export function servingCatalogue(
  bundle: CatalogueBundle = testCatalogue,
): Readonly<Record<string, unknown>> {
  return { '/catalogue/checksum': { sha256: bundle.sha256 }, '/catalogue': bundle }
}
