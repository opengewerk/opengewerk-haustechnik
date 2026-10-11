import { describe, expect, it } from 'vitest'

import { taskHomeOf, taskTargetProblem } from './task.js'

describe('what a task hangs on', () => {
  it('is its property, and at most one record there', () => {
    expect(taskTargetProblem({ propertyId: 'p' })).toBeNull()
    expect(taskTargetProblem({ propertyId: 'p', assetId: 'a' })).toBeNull()
    expect(taskTargetProblem({ propertyId: 'p', activityId: 'v', buildingId: null })).toBeNull()
    expect(taskTargetProblem({ propertyId: 'p', assetId: 'a', roomId: 'r' })).toBe(
      'Eine Aufgabe hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude oder einem Vorgang.',
    )
    expect(taskTargetProblem({ propertyId: 'p', buildingId: 'b', activityId: 'v' })).not.toBeNull()
  })

  it('is never nothing: a task without a property has no area', () => {
    expect(taskTargetProblem({})).toBe('Eine Aufgabe hängt an einer Liegenschaft.')
    expect(taskTargetProblem({ propertyId: '', assetId: 'a' })).toBe(
      'Eine Aufgabe hängt an einer Liegenschaft.',
    )
  })

  it('is named by the record besides the property, or the property', () => {
    expect(taskHomeOf({ propertyId: 'p', roomId: 'r' })).toBe('roomId')
    expect(taskHomeOf({ propertyId: 'p', activityId: 'v' })).toBe('activityId')
    expect(taskHomeOf({ propertyId: 'p', assetId: null })).toBe('propertyId')
  })
})
