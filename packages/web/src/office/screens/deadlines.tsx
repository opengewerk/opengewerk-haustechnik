import {
  byNameIn,
  type DeadlineFacts,
  deadlineSubject,
  deadlineTableColumns,
  deadlineWhere,
  meterDeadlineSubject,
  type PlaceNames,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
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

import { useAreas } from '../../session/areas.js'
import { contractPlaces } from '../contract-addresses.js'
import { contractorPlaces } from '../contractor-addresses.js'
import { defectPlaces } from '../defect-addresses.js'
import { documentPlaces } from '../document-addresses.js'
import { dutyPlaces } from '../duty-addresses.js'
import { meterListPlace, meterListWords } from '../meter-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { workOrderPlaces } from '../work-order-addresses.js'
import { planPlaces } from '../round-template-addresses.js'
import { dutyColleaguesQuery } from './duty.js'

/** A deadline of this application as the list reads it: what every one says, and its duty or its defect. */
export type DutyDeadlineView = DeadlineView & DeadlineFacts

/** What the list and the settings say in the words of this application. */
export const deadlineWords = {
  meters: meterDeadlineSubject,
  sub: 'Was fällig wird, nach Fälligkeit. Eine Frist folgt ihrer Pflicht, ihrem Mangel, dem Plan eines Rundgangs, den Zählern einer Liegenschaft oder dem Datum eines Dokuments: mit dem nächsten Nachweis rückt sie weiter, mit der Anlage ruht sie, mit der Beseitigung fällt sie weg, mit dem nächsten Rundgang rückt sie zum nächsten Durchgang, mit den Ständen zum nächsten Stichtag, mit der neuen Fassung zu deren Datum.',
  searchPlaceholder: 'Pflicht, Mangel, Anlage, Liegenschaft …',
  emptyOpen:
    'Gerade ist keine Frist offen. Eine Frist entsteht mit dem ersten Termin einer bestätigten Pflicht, mit der Frist eines Mangels, mit dem Plan eines Rundgangs, mit den Zählern einer Liegenschaft und mit dem Datum eines Dokuments.',
  responsibleOfTheDuty: 'Wen die Pflicht nennt',
  responsibleOfThePlan: 'Wen der Plan nennt',
  responsibleOfTheDocument: 'Wer das Datum gesetzt hat',
  anchor: 'dem letzten Nachweis',
  defectAnchor: 'dem Tag der Feststellung',
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
  if (kind.responsible === 'lead') {
    return 'Die Leitung'
  }

  // The day of a document is answered for by whoever set it (#327).
  return kind.source === 'round_plan'
    ? deadlineWords.responsibleOfThePlan
    : kind.source === 'document' || kind.source === 'risk_assessment'
      ? deadlineWords.responsibleOfTheDocument
      : deadlineWords.responsibleOfTheDuty
}

/** What a deadline is called in the list, as its table names it (#236), and where its name leads. */
function sourceOf(deadline: DutyDeadlineView): { readonly href: string; readonly name: string } {
  const name = deadlineSubject(deadline)

  switch (deadline.follows) {
    case 'defect':
      return { href: defectPlaces.defect(deadline.defectId), name }
    case 'round':
      return { href: planPlaces.plan(deadline.roundPlanId), name }
    case 'duty':
      return { href: dutyPlaces.duty(deadline.dutyId), name }
    case 'meter':
      // The meters of the property whose reading is missing (#120).
      return {
        href: `${meterListPlace.to}?${meterListWords.property}=${deadline.propertyId}&${meterListWords.state}=missing`,
        name,
      }
    case 'document':
      // The document whose newest version names the day (#327).
      return { href: documentPlaces.document(deadline.attachmentId), name }
    case 'contract':
      // The contract whose day to give notice or end it is (#329).
      return { href: contractPlaces.contract(deadline.contract.id), name }
    case 'warranty':
      // The accepted work order or the asset whose warranty ends (#329).
      return {
        href:
          deadline.workOrder !== null
            ? workOrderPlaces.order(deadline.workOrder.id)
            : deadline.asset !== null
              ? officePlaces.asset(deadline.asset.id)
              : officePlaces.property(deadline.propertyId),
        name,
      }
  }
}

const byId = (records: readonly RecordState[], id: string | null) =>
  id === null ? null : (records.find((record) => record['id'] === id) ?? null)

/**
 * What a duty hangs on, as two lines: the asset or the place, and where it
 * stands, in the words its table writes (#236), with the names of the places
 * this device holds.
 */
function useWhere(): (deadline: DutyDeadlineView) => { name: string; to: string; sub: string } {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const names: PlaceNames = {
    property: (id) => maybeText(byId(properties, id), 'name'),
    building: (id) => maybeText(byId(buildings, id), 'name'),
    room: (id) => {
      const room = byId(rooms, id)

      return room === null
        ? null
        : {
            number: maybeText(room, 'number'),
            name: maybeText(room, 'name'),
            buildingId: maybeText(room, 'buildingId') ?? '',
          }
    },
  }

  return (deadline) => {
    const { name, sub } = deadlineWhere(deadline, names)
    // The document of a contractor (#328) stands at the firm, which has no place;
    // a contract and its documents (#329) at the contract.
    const to =
      deadline.propertyId === null
        ? deadline.follows === 'contract'
          ? contractPlaces.contract(deadline.contract.id)
          : deadline.follows === 'document' && deadline.contract !== null
            ? contractPlaces.contract(deadline.contract.id)
            : deadline.follows === 'document' && deadline.contractor !== null
              ? contractorPlaces.contractor(deadline.contractor.id)
              : contractorPlaces.list
        : deadline.asset !== null
          ? officePlaces.asset(deadline.asset.id)
          : deadline.roomId !== null
            ? officePlaces.room(deadline.roomId)
            : deadline.buildingId !== null
              ? officePlaces.building(deadline.buildingId)
              : officePlaces.property(deadline.propertyId)

    return { name, to, sub }
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
        .sort((left, right) => byNameIn(left.label, right.label)),
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
        href: (deadline) => sourceOf(deadline).href,
        name: (deadline) => sourceOf(deadline).name,
      }}
      columns={[
        {
          header: deadlineTableColumns.where,
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
      table
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
      anchorWords={(kind) =>
        kind.source === 'defect' ? deadlineWords.defectAnchor : deadlineWords.anchor
      }
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
      intervalWords={(kind) => ({
        label: 'Frist',
        hint:
          kind.source === 'defect'
            ? 'Die Frist nennt jeder Mangel selbst, nach der Vorgabe seiner Klasse.'
            : kind.source === 'round_plan'
              ? 'Die Tage nennt jeder Plan selbst.'
              : kind.source === 'meter'
                ? 'Den Stichtag stellen Sie unter „Zähler“ ein; eine Messstelle kann davon abweichen.'
                : kind.source === 'contract_notice' || kind.source === 'contract_end'
                  ? 'Laufzeit und Kündigungsfrist nennt jeder Vertrag selbst.'
                  : kind.source === 'warranty'
                    ? 'Den Tag nennt die Anlage oder der abgenommene Auftrag selbst.'
                    : 'Die Frist gibt jede Pflicht selbst vor.',
      })}
      actionsSentence={(kind) =>
        kind.source === 'defect'
          ? 'Erinnert die Leitung, wenn der Vorlauf beginnt. Ist der Mangel behoben, fällt die Frist weg.'
          : kind.source === 'meter'
            ? 'Erinnert die Leitung, wenn der Vorlauf beginnt, und gibt ihr die Aufgabe „Zähler ablesen“, einmal je Liegenschaft. Hat jede Messstelle dort ihren Stand, ist die Aufgabe erledigt und die Frist geht zum nächsten Stichtag.'
            : kind.source === 'round_plan'
              ? 'Legt die Rundgänge eines Plans an, so weit der Vorlauf reicht, jeden Durchgang einmal, damit die Rundgänge der nächsten Woche vorher zugeteilt werden können. Erinnert niemanden.'
              : kind.source === 'contract_notice' ||
                  kind.source === 'contract_end' ||
                  kind.source === 'warranty'
                ? 'Erinnert die Leitung, wenn der Vorlauf beginnt, oder wen Sie hier nennen.'
                : 'Erinnert die verantwortliche Person und legt bei ihr die Prüfung oder Wartung an, wenn der Vorlauf beginnt. Nennt die Pflicht niemanden, die Leitung.'
      }
      badge={() => null}
      note={deadlineWords.settingsNote}
    />
  )
}
