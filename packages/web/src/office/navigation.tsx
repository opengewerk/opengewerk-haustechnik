import {
  deadlinePage,
  type NavigationEntry,
  type NavigationGroup,
} from '@opengewerk/platform-web/office'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  Building2,
  Calendar,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  Route,
  SearchCheck,
  SquareCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react'

import { type Offer, useOffered } from '../app/places.js'
import { defectListPlace, defectSummaryQuery } from './defect-addresses.js'
import { placeRoots } from './place-addresses.js'

/** A place of the navigation: the entry the frame draws, and what it asks before it stands there. */
export type OfficePlace = NavigationEntry & Offer

/** Places under a title, or before the titled ones without one. */
export interface OfficePlaces {
  readonly title?: string
  readonly entries: readonly OfficePlace[]
}

/** Where the deadlines are, which the navigation counts beside its entry. */
const deadlinesPlace = '/fristen'

/**
 * The navigation of the office as the board "Navigation mit dem Pfad" draws
 * it (4.1 of the concept): the overview first, then what a tenant has, what
 * it owes and what is done about it. The side bar follows the data model.
 *
 * Every place is written down here once, in the order of the board. It
 * stands in the navigation from the moment a screen answers at its address
 * (`useBuilt`), and only for somebody who holds its right. So the role
 * "Haustechnik" misses "Fristen", as the board says; "Einstellungen", which
 * it misses as well, is the frame's own entry and stands for whoever may
 * read one of the settings.
 *
 * "Aufgaben" names no right yet. Its own arrives with the tasks, and all
 * four roles are to see them (the last point under the table of rights in
 * section 7 of the concept). The overview and the catalogue hold nothing of
 * a tenant that somebody signed in may not see.
 */
export const officeNavigation: readonly OfficePlaces[] = [
  {
    entries: [{ to: '/', label: 'Übersicht', icon: LayoutDashboard }],
  },
  {
    title: 'Bestand',
    entries: [
      {
        to: '/liegenschaften',
        label: 'Liegenschaften',
        icon: Building2,
        right: 'location.read',
        // A building, a floor and a room live at an address of their own.
        also: placeRoots,
      },
      { to: '/anlagen', label: 'Anlagen', icon: Zap, right: 'asset.read' },
      // A meter is an asset with readings (4.9).
      { to: '/zaehler', label: 'Zähler', icon: Gauge, right: 'asset.read' },
      { to: '/dokumente', label: 'Dokumente', icon: FileText, right: 'document.read' },
    ],
  },
  {
    title: 'Pflichten',
    entries: [
      { to: '/pflichten', label: 'Pflichtenverzeichnis', icon: ClipboardCheck, right: 'duty.read' },
      { to: deadlinesPlace, label: 'Fristen', icon: CalendarClock, right: 'deadline.read' },
      // The page of an evidence stands under the inspections, as an
      // inspection is the way most evidence comes about.
      {
        to: '/pruefungen',
        label: 'Prüfungen',
        icon: SearchCheck,
        right: 'activity.read',
        also: ['/nachweise'],
      },
    ],
  },
  {
    title: 'Arbeit',
    entries: [
      { to: '/rundgaenge', label: 'Rundgänge', icon: Route, right: 'activity.read' },
      { to: defectListPlace.to, label: 'Mängel', icon: TriangleAlert, right: 'defect.read' },
      { to: '/auftraege', label: 'Aufträge', icon: Calendar, right: 'activity.read' },
      { to: '/aufgaben', label: 'Aufgaben', icon: SquareCheck },
    ],
  },
]

/**
 * What is visited rather than worked in, at the foot before the exchange with
 * the server and the settings, which the frame of the foundation adds itself.
 */
export const officeFoot: readonly OfficePlace[] = [
  { to: '/katalog', label: 'Katalog', icon: BookOpen },
]

/**
 * How many open deadlines are past their day, in the areas of the person
 * (#104, the badge of the board): the number of a page of one that asks for
 * the late ones, and nothing for whoever may not read the deadlines. It
 * counts the deadlines and never a person's.
 */
function useLateDeadlines(reads: boolean): number {
  const late = useQuery({
    queryKey: ['deadlines', 'late'],
    queryFn: () => deadlinePage({ status: 'open', late: true, limit: 1 }),
    enabled: reads,
    staleTime: 60_000,
  })

  return reads ? (late.data?.total ?? 0) : 0
}

/**
 * How many defects are past the day they were to be set right by, in the
 * areas of the person (#116): the number beside "Mängel", and nothing for
 * whoever may not read the defects. It counts the defects and never a
 * person's.
 */
function useLateDefects(reads: boolean): number {
  const late = useQuery({ ...defectSummaryQuery, enabled: reads, staleTime: 60_000 })

  return reads ? (late.data?.overdue ?? 0) : 0
}

/** The badge of a number of late ones, in the colour of a conflict. */
function lateBadge(late: number, word: string): NavigationEntry['badge'] {
  return {
    value: late,
    tone: 'conflict',
    // The figure as it stands beside the entry, so that whoever says what they see
    // finds it in the name (WCAG 2.5.3, #132): "Mängel, 1 über der Frist".
    spoken: `${String(late)} ${word}`,
  }
}

/**
 * What the office offers the person signed in, in the groups of the board. A
 * group nobody is offered a place of goes with its title, which the frame
 * sees to. "Fristen" carries the number of the late ones, and "Mängel" the
 * number of those over their deadline, as the board counts beside them in
 * the colour of a conflict.
 */
export function useNavigation(): {
  readonly groups: readonly NavigationGroup[]
  readonly foot: readonly NavigationEntry[]
} {
  const every = useOffered([...officeNavigation.flatMap((group) => group.entries), ...officeFoot])
  const stands = (place: OfficePlace) => every.includes(place)
  const late = useLateDeadlines(every.some((place) => place.to === deadlinesPlace))
  const lateDefects = useLateDefects(every.some((place) => place.to === defectListPlace.to))
  const counted = (place: OfficePlace): NavigationEntry =>
    place.to === deadlinesPlace && late > 0
      ? { ...place, badge: lateBadge(late, 'überfällig') }
      : place.to === defectListPlace.to && lateDefects > 0
        ? { ...place, badge: lateBadge(lateDefects, 'über der Frist') }
        : place

  return {
    groups: officeNavigation.map((group) => ({
      ...(group.title === undefined ? {} : { title: group.title }),
      entries: group.entries.filter(stands).map(counted),
    })),
    foot: officeFoot.filter(stands),
  }
}
