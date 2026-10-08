import { describe, expect, it } from 'vitest'

import {
  documentHomeOf,
  documentKindLabel,
  documentKinds,
  documentLimits,
  documentProblems,
  documentTargetProblem,
  documentTitleOf,
  operatorDocuments,
} from './document.js'
import { offlineEditRefusal, offlineRules } from './sync.js'

describe('a document of an operator', () => {
  it('hangs on a property, a building, a room, an asset, an activity or a defect', () => {
    expect(operatorDocuments.homes).toEqual([
      'propertyId',
      'buildingId',
      'roomId',
      'assetId',
      'activityId',
      'defectId',
    ])

    for (const home of operatorDocuments.homes) {
      expect(operatorDocuments.homeProblem({ [home]: 'a-record' })).toBeNull()
    }
  })

  it('is told in a sentence where it may hang when it names nothing', () => {
    for (const none of [{}, { propertyId: null }, { propertyId: '', assetId: null }]) {
      expect(operatorDocuments.homeProblem(none)).toBe(
        'Ein Dokument hängt an einer Liegenschaft, einem Gebäude, einem Raum, einer Anlage, einem Vorgang oder einem Mangel.',
      )
    }
  })

  it('hangs on its property or on exactly one record there', () => {
    expect(documentTargetProblem({})).toBeNull()
    expect(documentTargetProblem({ assetId: null, roomId: undefined, buildingId: '' })).toBeNull()
    // An empty text is a field nobody filled in, and names nothing beside the one that is.
    expect(documentTargetProblem({ assetId: 'an-asset', roomId: '' })).toBeNull()

    for (const field of ['assetId', 'roomId', 'buildingId', 'activityId']) {
      expect(documentTargetProblem({ [field]: 'a-record' })).toBeNull()
    }

    for (const two of [
      { assetId: 'an-asset', roomId: 'a-room' },
      { buildingId: 'a-building', activityId: 'an-activity' },
      { assetId: 'an-asset', activityId: 'an-activity' },
    ]) {
      expect(documentTargetProblem(two)).toBe(
        'Ein Dokument hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude, einem Vorgang oder einem Mangel.',
      )
    }
  })

  it('says what it hangs on: the one record it names, or its property', () => {
    expect(documentHomeOf({ propertyId: 'a-property' })).toBe('propertyId')
    expect(documentHomeOf({ propertyId: 'a-property', assetId: null })).toBe('propertyId')
    expect(documentHomeOf({ propertyId: 'a-property', assetId: 'an-asset' })).toBe('assetId')
    expect(documentHomeOf({ propertyId: 'a-property', roomId: 'a-room' })).toBe('roomId')
    expect(documentHomeOf({ propertyId: 'a-property', buildingId: 'a-building' })).toBe(
      'buildingId',
    )
    expect(documentHomeOf({ propertyId: 'a-property', activityId: 'an-activity' })).toBe(
      'activityId',
    )
  })

  it('has one of the six kinds of the concept, or none', () => {
    expect(documentKinds.map((kind) => documentKindLabel[kind])).toEqual([
      'Betriebsanleitung',
      'Prüfbescheinigung',
      'Schaltplan',
      'Revisionsunterlage',
      'Genehmigung',
      'Konzept',
    ])

    for (const kind of [...documentKinds, null, undefined]) {
      expect(documentProblems({ title: 'Schaltplan UV-EG', kind })).toEqual({})
    }

    expect(documentProblems({ kind: 'invoice' })).toEqual({
      kind: 'Diese Art eines Dokuments gibt es nicht.',
    })
  })

  it('cannot be without a name, and its name is no longer than the bound', () => {
    expect(documentProblems({ title: ' ' })).toEqual({ title: 'Die Bezeichnung fehlt.' })
    expect(documentProblems({ title: null })).toEqual({ title: 'Die Bezeichnung fehlt.' })
    expect(documentProblems({ title: 'x'.repeat(documentLimits.title) })).toEqual({})
    // Spaces around a name are not counted, a route and the sync take them off.
    expect(documentProblems({ title: ` ${'x'.repeat(documentLimits.title)} ` })).toEqual({})
    expect(documentProblems({ title: 'x'.repeat(documentLimits.title + 1) })).toEqual({
      title: 'Die Bezeichnung hat höchstens 120 Zeichen.',
    })
    // A change of other fields says nothing about the name.
    expect(documentProblems({ kind: 'concept' })).toEqual({})
  })

  it('takes its name from its file, without the ending and within the bound', () => {
    expect(documentTitleOf('Schaltplan UV-EG.pdf')).toBe('Schaltplan UV-EG')
    expect(documentTitleOf('.pdf')).toBe('.pdf')
    expect(documentTitleOf('   ')).toBe('Dokument')
    expect(documentTitleOf(`${'x'.repeat(200)}.pdf`)).toBe('x'.repeat(documentLimits.title))
    // A name cut in front of a space ends without it, as the database keeps a name.
    expect(documentTitleOf(`${'x'.repeat(119)} y.pdf`)).toBe('x'.repeat(119))
  })

  it('names the type of a file the way the store records it', () => {
    expect(operatorDocuments.mediaTypeProblem('application/pdf')).toBeNull()
    expect(operatorDocuments.mediaTypeProblem('Application/PDF; charset=x')).toBe(
      'Der Typ der Datei ist nicht so angegeben, wie die Ablage ihn festhält.',
    )
  })
})

describe('what a device does with a document', () => {
  it('files one and a version of it, also without a connection', () => {
    expect(offlineRules.policyFor('attachments')).toMatchObject({ create: true, change: 'merge' })
    expect(offlineRules.policyFor('attachment_versions')).toMatchObject({
      create: true,
      change: 'never',
    })
    expect(
      offlineEditRefusal({
        entity: 'attachments',
        kind: 'create',
        patches: [
          { field: 'title', from: null, to: 'Typenschild' },
          { field: 'propertyId', from: null, to: 'a-property' },
          { field: 'assetId', from: null, to: 'an-asset' },
        ],
      }),
    ).toBeNull()
    expect(
      offlineEditRefusal({
        entity: 'attachment_versions',
        kind: 'create',
        patches: [
          { field: 'attachmentId', from: null, to: 'a-document' },
          { field: 'sha256', from: null, to: 'a'.repeat(64) },
          { field: 'fileName', from: null, to: 'typenschild.jpg' },
          { field: 'mediaType', from: null, to: 'image/jpeg' },
          { field: 'sizeBytes', from: null, to: 12 },
          { field: 'previewSha256', from: null, to: null },
        ],
      }),
    ).toBeNull()
  })

  it('corrects its name and its kind, and never what it hangs on', () => {
    expect(
      offlineEditRefusal({
        entity: 'attachments',
        kind: 'update',
        patches: [
          { field: 'title', from: null, to: 'Typenschild Heizkessel' },
          { field: 'kind', from: null, to: 'operating_manual' },
        ],
      }),
    ).toBeNull()

    for (const field of ['propertyId', 'buildingId', 'roomId', 'assetId', 'activityId']) {
      expect(
        offlineEditRefusal({
          entity: 'attachments',
          kind: 'update',
          patches: [{ field, from: null, to: 'another-record' }],
        }),
      ).toEqual([field])
    }
  })

  it('takes one out of the records through the outbox, and removes no version', () => {
    expect(offlineEditRefusal({ entity: 'attachments', kind: 'delete', patches: [] })).toBeNull()
    expect(
      offlineEditRefusal({ entity: 'attachment_versions', kind: 'delete', patches: [] }),
    ).toEqual([])
  })

  it('leaves the area and who filed a version to the server', () => {
    expect(offlineRules.isSetByServer('attachments', 'areaId')).toBe(true)
    expect(offlineRules.isSetByServer('attachment_versions', 'createdBy')).toBe(true)
    expect(offlineRules.isSetByServer('attachments', 'propertyId')).toBe(false)
  })
})
