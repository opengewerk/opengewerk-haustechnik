import {
  byNameIn,
  type RecordState,
  taskEntity,
  taskLimits,
  taskListWords,
  type TaskTargetField,
  taskWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { PageHead, Screen, useTableExport } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecords, useRelated } from '@opengewerk/platform-web/sync'
import { NewTaskForm, TaskList } from '@opengewerk/platform-web/tasks'
import type { NewTaskPlace } from '@opengewerk/platform-web/tasks'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useHeldArea } from '../session/areas.js'
import { titleOfRoom } from '../app/place-records.js'
import { type TaskAddresses, taskTargetOf, useTaskHomes, useTaskPeople } from '../app/tasks.js'
import { activityPlaces } from './activity-addresses.js'
import { officePlaces } from './place-addresses.js'
import { roundPlaces } from './round-template-addresses.js'
import { workOrderPlaces } from './work-order-addresses.js'

/**
 * The tasks in the office (#124, section 3 of the concept): the list
 * "Aufgaben" and the card on the page of a property, a building, a room, an
 * asset and an activity, as the boards "Aufgaben an Ort, Anlage und Vorgang
 * (3)" and "Anlagenakte: Aufgabe anlegen (3)" draw them.
 *
 * Read from the device and written through its outbox, as the documents are
 * (ADR 0006, addendum of #124): a task is written and done in the office as
 * on site, also without a connection. The device holds the tasks of the
 * person and those the person wrote, and every task of the operator for
 * whoever sees every area.
 */

export const taskCardWords = {
  none: 'Hier hängt noch keine Aufgabe.',
  mineNone: 'Für Sie ist gerade nichts offen.',
  othersNone: 'Bei den anderen ist gerade nichts offen.',
  pageSub:
    'Was zu tun ist, nach Fälligkeit. Eine Aufgabe hängt an einem Ort, einer Anlage oder einem Vorgang.',
  mayNotRead: 'Aufgaben sehen darf dieser Zugang nicht.',
  choose: 'Bitte wählen',
} as const

/** Where the pages of the office are, for the link under a task. */
export const officeTaskAddresses: TaskAddresses = {
  property: officePlaces.property,
  building: officePlaces.building,
  room: officePlaces.room,
  asset: officePlaces.asset,
  activity: (id, kind) =>
    kind === 'work_order'
      ? workOrderPlaces.order(id)
      : kind === 'round'
        ? roundPlaces.round(id)
        : activityPlaces.activity(id),
}

/** The field of a task that names the record a card stands on. */
export type TaskCardField = 'propertyId' | TaskTargetField

export interface TasksCardProps {
  /** The field of a task that names the record of the page, and its id. */
  readonly field: TaskCardField
  readonly id: string
  /** The property the record lies on, which every task names. */
  readonly propertyId: string
  /** The area of that property: who a task here may go to. */
  readonly areaId: string | null
  /**
   * Whether a task may be written here at all: not on a property whose area
   * the person does not hold (#309).
   */
  readonly adds?: boolean
}

/**
 * The tasks that hang on one record, on that record's page.
 *
 * Where a task hangs is where it is looked for while somebody works on that
 * record: a task that only stood in a central list would be overlooked
 * exactly there. Written here, it takes the record with it. On the page of a
 * property every task on the property stands, with the record it hangs on
 * where that is more than the property.
 */
export function TasksCard({ field, id, propertyId, areaId, adds = true }: TasksCardProps) {
  const reads = useRight('task.read')
  const people = useTaskPeople()
  const tasks = useRelated(taskEntity, field, id)
  const homeOf = useTaskHomes(officeTaskAddresses)
  const [adding, setAdding] = useState(false)

  if (!reads) {
    return null
  }

  const target =
    field === 'propertyId'
      ? taskTargetOf((task) =>
          (maybeText(task, 'buildingId') ??
          maybeText(task, 'roomId') ??
          maybeText(task, 'assetId') ??
          maybeText(task, 'activityId'))
            ? homeOf(task)
            : null,
        )
      : undefined

  return (
    <Panel
      title="Aufgaben"
      action={
        people.records && adds && !adding ? (
          <Button
            size="small"
            icon={Plus}
            onClick={() => {
              setAdding(true)
            }}
          >
            Aufgabe anlegen
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div className="mb-3">
          <NewTaskForm
            links={field === 'propertyId' ? { propertyId } : { propertyId, [field]: id }}
            me={people.me}
            myName={people.myName}
            others={() => people.othersIn(areaId)}
            words={taskWords}
            longest={taskLimits.title}
            onDone={() => {
              setAdding(false)
            }}
          />
        </div>
      ) : null}
      <TaskList
        tasks={tasks}
        me={people.me}
        people={people.people}
        words={taskWords}
        mayChange={people.mayChange}
        {...(target ? { targetOf: target } : {})}
        empty={taskCardWords.none}
      />
    </Panel>
  )
}

/** A choice of the field "Woran": the kind of record and its id, `assetId:<id>`. */
function placeValue(field: string, record: RecordState): string {
  return `${field}:${String(record['id'])}`
}

/**
 * The field "Woran" of the list: a property, a building, a room or an asset
 * the device holds, each by the words its link says. A task at an activity
 * is written on the page of the activity.
 */
function usePlaceField(): {
  readonly place: NewTaskPlace
  readonly areaOf: (value: string) => string | null
} {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')
  const held = useHeldArea()

  return useMemo(() => {
    const property = new Map(properties.map((each) => [String(each['id']), each]))
    const building = new Map(buildings.map((each) => [String(each['id']), each]))
    const name = (record: RecordState | undefined) => maybeText(record ?? null, 'name') ?? ''
    const byLabel = (left: { label: string }, right: { label: string }) =>
      byNameIn(left.label, right.label)
    const options = [
      ...properties
        .filter((each) => held(each['areaId']))
        .map((each) => ({
          value: placeValue('propertyId', each),
          label: `Liegenschaft ${name(each)}`,
        }))
        .sort(byLabel),
      ...buildings
        .map((each) => ({
          value: placeValue('buildingId', each),
          label: `Gebäude ${name(each)}, ${name(property.get(text(each, 'propertyId')))}`,
        }))
        .sort(byLabel),
      ...rooms
        .map((each) => ({
          value: placeValue('roomId', each),
          label: `Raum ${titleOfRoom(each)}, ${name(building.get(text(each, 'buildingId')))}`,
        }))
        .sort(byLabel),
      ...assets
        .map((each) => ({
          value: placeValue('assetId', each),
          label: [
            [maybeText(each, 'number'), name(each)].filter(Boolean).join(' '),
            name(building.get(text(each, 'buildingId'))),
          ]
            .filter(Boolean)
            .join(', '),
        }))
        .sort(byLabel),
    ]
    const recordOf = (value: string): RecordState | undefined => {
      const [field, id] = value.split(':')
      const list =
        field === 'propertyId'
          ? properties
          : field === 'buildingId'
            ? buildings
            : field === 'roomId'
              ? rooms
              : assets

      return list.find((each) => String(each['id']) === id)
    }
    const propertyIdOf = (value: string): string | null => {
      const [field, id] = value.split(':')
      const record = recordOf(value)

      return field === 'propertyId'
        ? (id ?? null)
        : (maybeText(record ?? null, 'propertyId') ?? null)
    }

    return {
      place: {
        field: {
          name: 'place',
          label: 'Woran',
          required: true,
          options: [{ value: '', label: taskCardWords.choose }, ...options],
        },
        linksOf: (value: string) => {
          const [field, id] = value.split(':')
          const propertyId = propertyIdOf(value)

          return field === undefined || id === undefined || propertyId === null
            ? {}
            : field === 'propertyId'
              ? { propertyId }
              : { propertyId, [field]: id }
        },
      },
      areaOf: (value: string) => {
        const propertyId = propertyIdOf(value)

        return propertyId === null
          ? null
          : (maybeText(property.get(propertyId) ?? null, 'areaId') ?? null)
      },
    }
  }, [properties, buildings, rooms, assets, held])
}

/**
 * "Aufgaben": everything that is left to do, starting with one's own.
 *
 * The person's own first, then what is open with the others on this device,
 * because whoever hands tasks out has to see whether they are done. What is
 * done is left out of both; it stays on the record it hangs on. Nothing here
 * is narrowed to a person or counted (section 9 of the concept).
 */
export function TaskListScreen() {
  const reads = useRight('task.read')
  const people = useTaskPeople()
  const tasks = useRecords(taskEntity)
  const homeOf = useTaskHomes(officeTaskAddresses)
  const { place, areaOf } = usePlaceField()
  const [adding, setAdding] = useState(false)
  const open = tasks.filter((task) => text(task, 'status') === 'open')
  const mine = open.filter((task) => text(task, 'assigneeUserId') === people.me)
  const others = open.filter((task) => text(task, 'assigneeUserId') !== people.me)
  const targetOf = taskTargetOf(homeOf)
  // The open tasks the two lists show, as a table (#236).
  const table = useTableExport('/tasks/table')

  return (
    <Screen>
      <PageHead
        title="Aufgaben"
        sub={taskCardWords.pageSub}
        wideActions
        actions={
          <>
            {reads ? table.button : null}
            {reads && people.records ? (
              <Button
                tone="primary"
                icon={Plus}
                disabled={adding}
                onClick={() => {
                  setAdding(true)
                }}
              >
                Aufgabe anlegen
              </Button>
            ) : null}
          </>
        }
      />
      {reads ? table.trouble : null}
      {!reads ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">{taskCardWords.mayNotRead}</p>
      ) : (
        <>
          {adding ? (
            <Panel title="Neue Aufgabe">
              <NewTaskForm
                place={place}
                me={people.me}
                myName={people.myName}
                others={(values) => people.othersIn(areaOf(values['place'] ?? ''))}
                words={taskWords}
                longest={taskLimits.title}
                wide
                onDone={() => {
                  setAdding(false)
                }}
              />
            </Panel>
          ) : null}
          <div className="grid gap-3.5 lg:grid-cols-2">
            <Panel title={taskListWords.mine}>
              <TaskList
                tasks={mine}
                me={people.me}
                people={people.people}
                words={taskWords}
                mayChange={people.mayChange}
                targetOf={targetOf}
                empty={taskCardWords.mineNone}
              />
            </Panel>
            <Panel title={taskListWords.others}>
              <TaskList
                tasks={others}
                me={people.me}
                people={people.people}
                words={taskWords}
                mayChange={people.mayChange}
                targetOf={targetOf}
                empty={taskCardWords.othersNone}
              />
            </Panel>
          </div>
        </>
      )}
    </Screen>
  )
}
