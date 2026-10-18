import {
  addDays,
  addMonths,
  type CataloguePackage,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'

import { dayInGermany } from '../today.js'

/**
 * A new version of a package for the preview (#139): the main test of a lift
 * in a second version, and the rule of its maximum continued with one year,
 * both from a day to come. So the preview shows what a new version means for
 * the duties that are confirmed: the note, the report with what changes, the
 * mark of a duty, and the two decisions.
 *
 * It is invented, as the operator of the preview is: no regulation shortens
 * the interval of the main test of a lift. The package of the build and the
 * probe package under `packages/catalogue` say nothing of it; only the
 * catalogue of the preview holds it, and its source says that it is an
 * example.
 */

const mainTest = 'probe.elevator_main_test'

/**
 * The day the example begins: the first of the month three months from the
 * day the preview starts. Always to come, so that the duties of the sample
 * are confirmed under the first version, with the maximum of today.
 */
export function announcedFrom(today: IsoDate = dayInGermany()): IsoDate {
  return `${addMonths(today, 3).slice(0, 7)}-01`
}

/** The probe package with the example in it; any other package as it is. */
export function withAnAnnouncedVersion(
  pack: CataloguePackage,
  from: IsoDate = announcedFrom(),
): CataloguePackage {
  const first = pack.dutyKinds.find((entry) => entry.key === mainTest && entry.version === 1)

  const interval = first?.definition.interval

  if (first === undefined || interval === undefined || !('rule' in interval)) {
    return pack
  }

  const { rule } = interval
  const unchecked = { checkedOn: first.review.checkedOn, accepted: null } as const

  return {
    ...pack,
    dutyKinds: [
      ...pack.dutyKinds,
      {
        ...first,
        version: 2,
        validFrom: from,
        definition: {
          ...first.definition,
          source: 'Beispiel der Vorschau zu Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
        },
        review: unchecked,
      },
    ],
    rules: pack.rules.flatMap((entry) =>
      entry.record.key === rule && entry.record.validUntil === null
        ? [
            { ...entry, record: { ...entry.record, validUntil: addDays(from, -1) } },
            {
              record: {
                ...entry.record,
                validFrom: from,
                value: 12,
                source: 'Beispiel der Vorschau, keine geltende Vorschrift',
              },
              review: unchecked,
            },
          ]
        : [entry],
    ),
  }
}
