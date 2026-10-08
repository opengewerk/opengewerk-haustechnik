import type { DutyDeadlineFacts, RecordState } from '@opengewerk/haustechnik-domain'
import {
  type DeadlineKindView,
  type DeadlineListFilter,
  DeadlineListScreen as FoundationDeadlineListScreen,
  type DeadlinePeople,
  DeadlineSettingsScreen as FoundationDeadlineSettingsScreen,
  type DeadlineView,
} from '@opengewerk/platform-web/office'
import { maybeText, useRecords } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { titleOfRoom } from '../../app/place-records.js'
import { useAreas } from '../../session/areas.js'
import { dutyPlaces } from '../duty-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { dutyColleaguesQuery } from './duty.js'

/** A deadline of this application as the list reads it: what every one says, and its duty. */
export interface DutyDeadlineView extends DeadlineView, DutyDeadlineFacts {}

/** What the list and the settings say in the words of this application. */
export const deadlineWords = {
  sub: 'Was fällig wird, nach Fälligkeit. Eine Frist folgt ihrer Pflicht: mit dem nächsten Nachweis rückt sie weiter, mit der Anlage ruht sie.',
  searchPlaceholder: 'Pflicht, Anlage, Liegenschaft …',
  emptyOpen:
    'Gerade ist keine Frist offen. Eine Frist entsteht mit dem ersten Termin einer bestätigten Pflicht.',
  responsibleOfTheDuty: 'Wen die Pflicht nennt',
  anchor: 'dem letzten Nachweis',
  settingsNote:
    'Eine Frist entsteht nie von Hand. Hier steht, was jede Art von sich aus tut; eine einzelne Frist ändern Sie in der Liste „Fristen“.',
} as const

/**
 * Whoever a deadline can be given to, from the choice of the register of
 * duties: the same two roles look after both. Nobody is called "du" here,
 * the office of this application says "Sie".
 */
function usePeople(): DeadlinePeople {
  const colleagues = useQuery(dutyColleaguesQuery)

  return { me: null, people: colleagues.data ?? [] }
}

/** Who answers for a deadline of a kind when nobody has said otherwise. */
function responsibleLabel(kind: DeadlineKindView): string {
  return kind.responsible === 'lead' ? 'Die Leitung' : deadlineWords.responsibleOfTheDuty
}

const byId = (records: readonly RecordState[], id: string | null) =>
  id === null ? null : (records.find((record) => record['id'] === id) ?? null)

/** What a duty hangs on, as two lines: the asset or the place, and where it stands. */
function useWhere(): (deadline: DutyDeadlineView) => { name: string; to: string; sub: string } {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  return (deadline) => {
    const property = maybeText(byId(properties, deadline.propertyId), 'name') ?? 'Liegenschaft'
    const building = maybeText(byId(buildings, deadline.buildingId), 'name')
    const place = [property, building].filter(Boolean).join(', ')

    if (deadline.asset !== null) {
      return {
        name: [deadline.asset.number, deadline.asset.name].filter(Boolean).join(' '),
        to: officePlaces.asset(deadline.asset.id),
        sub: place,
      }
    }

    if (deadline.roomId !== null) {
      const room = byId(rooms, deadline.roomId)
      // A duty at a room names no building; the room stands in one.
      const itsBuilding =
        building ?? maybeText(byId(buildings, maybeText(room, 'buildingId')), 'name')

      return {
        name: room ? titleOfRoom(room) : 'Raum',
        to: officePlaces.room(deadline.roomId),
        sub: [property, itsBuilding].filter(Boolean).join(', '),
      }
    }

    if (deadline.buildingId !== null) {
      return {
        name: building ?? 'Gebäude',
        to: officePlaces.building(deadline.buildingId),
        sub: property,
      }
    }

    return { name: property, to: officePlaces.property(deadline.propertyId), sub: 'Liegenschaft' }
  }
}

/**
 * "Fristen", `fristen()` of the boards (2.4 of the concept): the list of the
 * foundation with the duty a deadline follows, what the duty hangs on and
 * where, and two filters of this application (#75): the property, and the
 * area for whoever sees more than one; a person with one area gets only its
 * deadlines anyway. The list is paged and narrowed on the server, and
 * narrowed to one person it names no number (#104).
 */
export function DeadlineListScreen() {
  const where = useWhere()
  const properties = useRecords('properties')
  const areas = useAreas()
  const filters: DeadlineListFilter[] = [
    {
      key: 'property',
      label: 'Nach Liegenschaft filtern',
      all: 'Alle Liegenschaften',
      width: 'w-[200px]',
      options: properties
        .map((property) => ({
          value: String(property['id']),
          label: maybeText(property, 'name') ?? 'Liegenschaft',
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'de')),
    },
    ...(areas.length > 1
      ? [
          {
            key: 'area',
            label: 'Nach Bereich filtern',
            all: 'Alle Bereiche',
            width: 'w-[150px]',
            options: areas.map((area) => ({ value: area.id, label: area.name })),
          },
        ]
      : []),
  ]

  return (
    <FoundationDeadlineListScreen<DutyDeadlineView, DeadlineKindView>
      rights={{ read: 'deadline.read', write: 'deadline.write' }}
      words={deadlineWords}
      usePeople={usePeople}
      source={{
        href: (deadline) => dutyPlaces.duty(deadline.dutyId),
        name: (deadline) => deadline.dutyTitle,
      }}
      columns={[
        {
          header: 'Anlage und Ort',
          className: 'w-[236px] min-w-[180px]',
          text: (deadline) => {
            const { name, sub } = where(deadline)

            return `${name}, ${sub}`
          },
          cell: (deadline) => {
            const { name, to, sub } = where(deadline)

            return (
              <>
                <Link to={to} className="text-inherit no-underline hover:underline">
                  {name}
                </Link>
                <span className="block text-[12px] text-ink-faint">{sub}</span>
              </>
            )
          },
        },
      ]}
      filters={filters}
      cardFacts={(deadline) => {
        const { name, to, sub } = where(deadline)

        return (
          <span>
            <Link to={to} className={factLink}>
              {name}
            </Link>
            , {sub}
          </span>
        )
      }}
      responsibleLabel={responsibleLabel}
      anchorWords={() => deadlineWords.anchor}
    />
  )
}

/**
 * "Einstellungen", "Fristen", `fristen()` of the boards of the settings
 * (2.4): how early and to whom each kind of deadline reminds. A kind of this
 * application takes its interval from its duty, so only the lead and the
 * person are set here.
 */
export function DeadlineSettingsScreen() {
  return (
    <FoundationDeadlineSettingsScreen<DeadlineKindView>
      rights={{ write: 'deadline.write' }}
      usePeople={usePeople}
      responsibleLabel={responsibleLabel}
      intervalWords={() => ({ label: 'Frist', hint: 'Die Frist gibt jede Pflicht selbst vor.' })}
      actionsSentence={() =>
        'Erinnert die verantwortliche Person und legt bei ihr die Prüfung oder Wartung an, wenn der Vorlauf beginnt. Nennt die Pflicht niemanden, die Leitung.'
      }
      badge={() => null}
      note={deadlineWords.settingsNote}
    />
  )
}
