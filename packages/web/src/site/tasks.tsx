import { type RecordState, taskEntity, taskLimits, taskWords } from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import { SiteScreen, SiteText, TitleCount, TopTitle } from '@opengewerk/platform-web/site'
import {
  maybeText,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
} from '@opengewerk/platform-web/sync'
import { NewTaskForm, TaskList, TaskTarget } from '@opengewerk/platform-web/tasks'
import { Link } from '@tanstack/react-router'
import {
  Building,
  Building2,
  CalendarCheck,
  DoorOpen,
  type LucideIcon,
  Plus,
  SquareCheck,
  Zap,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { type TaskAddresses, type TaskHome, useTaskHomes, useTaskPeople } from '../app/tasks.js'
import type { TaskCardField } from '../office/tasks.js'
import { siteForms, sitePlaces } from './places.js'
import { longDay } from './start-items.js'

/**
 * The tasks on site (#124): "Meine Aufgaben" from the menu and the card at a
 * room, an asset and a work order, as the boards "Meine Aufgaben (3, 2.7)"
 * and "Aufgabe notieren, ohne Netz (3, 2.7)" draw them.
 *
 * The device holds the tasks of its person and those the person wrote
 * (section 2.7 of the concept). A task is ticked and written down without a
 * network, through the outbox; who else it may go to the server says, with a
 * connection, to whoever hands tasks out.
 */

export const siteTaskWords = {
  title: 'Meine Aufgaben',
  open: 'offen',
  none: 'Für Sie ist gerade nichts offen.',
  cardNone: 'Hier hängt noch keine Aufgabe.',
  write: 'Aufgabe notieren',
  saved: 'Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.',
} as const

/** Where the pages on site are, for the link under a task. */
export const siteTaskAddresses: TaskAddresses = {
  property: sitePlaces.property,
  building: sitePlaces.building,
  room: sitePlaces.room,
  asset: sitePlaces.asset,
  activity: (id) => siteForms.form(id),
}

const homeIcon: Readonly<Record<TaskHome['kind'], LucideIcon>> = {
  property: Building2,
  building: Building,
  room: DoorOpen,
  asset: Zap,
  activity: CalendarCheck,
}

/** The link under a task on site, with the symbol of the kind of record it hangs on. */
function siteTarget(homeOf: (task: RecordState) => TaskHome | null) {
  return (task: RecordState): ReactNode => {
    const home = homeOf(task)

    if (home === null) {
      return null
    }

    const Icon = homeIcon[home.kind]

    return (
      <TaskTarget to={home.to}>
        <Icon size={17} strokeWidth={2} aria-hidden="true" className="mr-1.5 inline align-[-2px]" />
        {home.label}
      </TaskTarget>
    )
  }
}

/**
 * The tasks that hang on one room, asset or work order, under what is to be
 * done there, and the way to write one down while standing in front of it.
 */
export function SiteTasksCard({
  field,
  id,
  propertyId,
}: {
  readonly field: Exclude<TaskCardField, 'propertyId'>
  readonly id: string
  /** The property the record lies on, whose area says who a task here may go to. */
  readonly propertyId: string | null
}) {
  const reads = useRight('task.read')
  const property = useRecord('properties', propertyId ?? undefined)
  const areaId = maybeText(property ?? null, 'areaId')
  const people = useTaskPeople()
  const tasks = useRelated(taskEntity, field, id)
  const [adding, setAdding] = useState(false)

  if (!reads || propertyId === null) {
    return null
  }

  return (
    <Panel title="Aufgaben">
      <div className="flex flex-col gap-2">
        <TaskList
          tasks={tasks}
          me={people.me}
          people={people.people}
          words={taskWords}
          mayChange={people.mayChange}
          empty={siteTaskWords.cardNone}
        />
        {adding ? (
          <NewTaskForm
            links={{ propertyId, [field]: id }}
            me={people.me}
            myName={people.myName}
            others={() => people.othersIn(areaId)}
            words={taskWords}
            longest={taskLimits.title}
            note={siteTaskWords.saved}
            onDone={() => {
              setAdding(false)
            }}
          />
        ) : people.records ? (
          <Button
            wide
            height={48}
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            {siteTaskWords.write}
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * "Meine Aufgaben": what is open for the person holding the device, in the
 * order it is worked through, each with the record it hangs on. A task ticked
 * here stays in the list while it has not reached the server, so that a tick
 * set by mistake is taken back where it was set.
 */
export function MyTasksScreen() {
  const people = useTaskPeople()
  const client = useSync()
  const tasks = useRecords(taskEntity)
  const homeOf = useTaskHomes(siteTaskAddresses, 'site')
  const mine = tasks.filter(
    (task) =>
      people.me !== null &&
      text(task, 'assigneeUserId') === people.me &&
      (text(task, 'status') === 'open' || client.isPending(taskEntity, String(task['id']))),
  )
  const open = mine.filter((task) => text(task, 'status') === 'open').length

  return (
    <SiteScreen gap={10}>
      <TopTitle
        over={longDay(today())}
        title={siteTaskWords.title}
        right={<TitleCount count={open} label={siteTaskWords.open} />}
      />
      {mine.length === 0 ? (
        <SiteText muted>{siteTaskWords.none}</SiteText>
      ) : (
        <TaskList
          tasks={mine}
          me={people.me}
          people={people.people}
          words={taskWords}
          mayChange={people.mayChange}
          targetOf={siteTarget(homeOf)}
          empty={siteTaskWords.none}
        />
      )}
    </SiteScreen>
  )
}

/** The row of the menu that leads to "Meine Aufgaben", for whoever looks at tasks. */
export function MyTasksMenuRow() {
  const reads = useRight('task.read')

  if (!reads) {
    return null
  }

  return (
    <Link
      to="/aufgaben"
      className="flex min-h-14 items-center gap-3 rounded-[6px] px-3.5 text-[17px] text-ink no-underline"
    >
      <SquareCheck size={22} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
      <span className="grow">{siteTaskWords.title}</span>
    </Link>
  )
}
