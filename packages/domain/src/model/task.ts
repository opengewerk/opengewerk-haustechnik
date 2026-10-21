import type { Id, IsoDate, TaskBase } from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'

/** The key of a task. */
export type TaskId = Id<'task'>

/**
 * Something one person has to do by a day (#124, section 3 of the concept),
 * at a place, an asset or an activity: the task of the foundation
 * (`TaskBase`) with what it hangs on here.
 *
 * A task hangs on its property always, and on at most one record there: a
 * building, a room, an asset or an activity. The property gives it its area,
 * so that a task is seen by whoever sees its place and by nobody else
 * (ADR 0003); a task at no place would have no area and would be seen by
 * either everybody or nobody.
 */
export interface Task extends TaskBase {
  readonly id: TaskId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly buildingId: BuildingId | null
  readonly roomId: RoomId | null
  readonly assetId: AssetId | null
  readonly activityId: ActivityId | null
  /** The day it was done (#412): written by the database from its status; a year later it goes. */
  readonly doneOn: IsoDate | null
}

/** How long the text of a task may be, in the form, at the sync and in the database. */
export const taskLimits = { title: 200 } as const

/** What a task may hang on besides its property, in the order a form asks them. */
export const taskTargetFields = ['assetId', 'roomId', 'buildingId', 'activityId'] as const

export type TaskTargetField = (typeof taskTargetFields)[number]

/** One of the places a task hangs on, its property included. */
export type TaskHome = 'propertyId' | TaskTargetField

/**
 * What is wrong with the place a task hangs on, or null: no property, or more
 * than one of an asset, a room, a building and an activity, which the database
 * refuses as well.
 */
export function taskTargetProblem(target: Readonly<Record<string, unknown>>): string | null {
  const given = (field: string) =>
    target[field] !== undefined && target[field] !== null && target[field] !== ''

  if (!given('propertyId')) {
    return 'Eine Aufgabe hängt an einer Liegenschaft.'
  }

  return taskTargetFields.filter(given).length > 1
    ? 'Eine Aufgabe hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude oder einem Vorgang.'
    : null
}

/**
 * What a task hangs on: the one record it names besides its property, or the
 * property where it names none.
 */
export function taskHomeOf(task: Readonly<Record<string, unknown>>): TaskHome {
  return (
    taskTargetFields.find((field) => task[field] !== undefined && task[field] !== null) ??
    'propertyId'
  )
}

/** How the person looking is addressed as the one a task is for. */
export const taskWords = { you: 'Sie' } as const

/** One person a task can name, by their name. */
export interface TaskPerson {
  readonly userId: string
  readonly name: string
}

/**
 * Who a task in each area of the person asking may go to (`GET
 * /tasks/candidates`): per area the people who may do tasks, are not shut out
 * and see it, by name. For whoever hands tasks out, so that the form offers
 * nobody the server would refuse.
 */
export interface TaskCandidates {
  readonly areas: readonly {
    readonly areaId: string
    readonly people: readonly TaskPerson[]
  }[]
}
