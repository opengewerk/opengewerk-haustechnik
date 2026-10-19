import { auditValues, auditVocabulary, catalogueOf } from '@opengewerk/haustechnik-domain'
import { auditWords } from '@opengewerk/platform-web/office'
import { describe, expect, it } from 'vitest'

import { testCatalogue } from '../app/test-catalogue.js'
import { auditScreenWords, auditScreenWordsWith } from './audit.js'

/**
 * What the change log says in the office beyond the vocabulary the server is
 * told as well: how a value is written, and where a record is opened.
 */
describe('the words of the change log in the office', () => {
  it('are the vocabulary the server is told', () => {
    expect(auditScreenWords.vocabulary).toBe(auditVocabulary)
  })

  it('write the state of a property as its name', () => {
    const states = auditScreenWords.values?.['properties']?.['federal_state']

    expect(states?.['DE-BW']).toBe('Baden-Württemberg')
    expect(states?.['DE-HE']).toBe('Hessen')
  })

  it('name a sequence of numbers by what it numbers, not by its key (#176)', () => {
    const words = auditWords(auditScreenWords)
    const page = {
      titles: {
        'nr-1': { table: 'number_ranges', field: 'key', title: 'asset', kind: null },
        'nr-2': { table: 'number_ranges', field: 'key', title: 'work_order', kind: null },
        'nr-3': { table: 'number_ranges', field: 'key', title: 'evidence', kind: null },
      },
      people: {},
      devices: {},
    }

    expect(
      ['nr-1', 'nr-2', 'nr-3'].map((id) => words.recordTitle('number_ranges', id, page)),
    ).toEqual(['Anlagen', 'Aufträge', 'Nachweise'])
    expect(words.auditValue('number_ranges', 'key', 'asset', page)).toBe('Anlagen')
  })

  describe('with the catalogue of the device at hand (#245)', () => {
    const words = auditWords(auditScreenWordsWith(catalogueOf(testCatalogue)))
    const page = {
      titles: {
        'd-1': { table: 'duties', field: 'kind', title: 'probe.elevator_main_test', kind: null },
        'd-2': { table: 'duties', field: 'label', title: 'Dachrinnen reinigen', kind: null },
        'd-3': { table: 'duties', field: 'kind', title: 'probe.long_gone', kind: null },
        'x-1': {
          table: 'duty_dismissals',
          field: 'kind',
          title: 'probe.interim_check',
          kind: null,
        },
        't-1': {
          table: 'defect_class_terms',
          field: 'defect_class',
          title: 'probe.severe',
          kind: null,
        },
      },
      people: {},
      devices: {},
    }

    it('name a duty from the catalogue and a dismissed proposal by the kind, not by its key', () => {
      expect(words.recordTitle('duties', 'd-1', page)).toBe('Hauptprüfung der Aufzugsanlage')
      expect(words.recordTitle('duty_dismissals', 'x-1', page)).toBe('Zwischenprüfung')
      // A duty of the operator's own keeps the name it was given.
      expect(words.recordTitle('duties', 'd-2', page)).toBe('Dachrinnen reinigen')
      // Wherever another record points at the duty, it reads the same.
      expect(words.auditValue('evidence', 'duty_id', 'd-1', page)).toBe(
        'Hauptprüfung der Aufzugsanlage',
      )
      expect(words.auditValue('duties', 'kind', 'probe.interim_check', page)).toBe(
        'Zwischenprüfung',
      )
    })

    // The same kind stands at many an asset, and the log says at which (#258).
    it('follow the name of a duty with what it stands at', () => {
      const withPlaces = {
        ...page,
        titles: {
          ...page.titles,
          'd-1': { ...page.titles['d-1'], at: { table: 'assets', id: 'a-1' } },
          'x-1': { ...page.titles['x-1'], at: { table: 'assets', id: 'a-1' } },
          'a-1': {
            table: 'assets',
            field: null,
            title: 'AN-00012 Aufzug Schulhaus',
            kind: 'probe.elevator',
          },
        },
      }

      expect(words.recordTitle('duties', 'd-1', withPlaces)).toBe(
        'Hauptprüfung der Aufzugsanlage, AN-00012 Aufzug Schulhaus',
      )
      expect(words.recordTitle('duty_dismissals', 'x-1', withPlaces)).toBe(
        'Zwischenprüfung, AN-00012 Aufzug Schulhaus',
      )
      expect(words.auditValue('evidence', 'duty_id', 'd-1', withPlaces)).toBe(
        'Hauptprüfung der Aufzugsanlage, AN-00012 Aufzug Schulhaus',
      )
    })

    // The form of a round is its template; the form of an inspection is a
    // key of the catalogue (#259).
    it('read the form of a round as its template, beside the forms of the catalogue', () => {
      const template = '0199aaaa-0000-7000-8000-000000000001'
      const withTemplate = {
        ...page,
        titles: {
          ...page.titles,
          [template]: {
            table: 'round_templates',
            field: 'title',
            title: 'Technikzentrale Schulhaus',
            kind: null,
          },
        },
      }

      expect(words.auditValue('activities', 'form_key', `template-${template}`, withTemplate)).toBe(
        'Technikzentrale Schulhaus',
      )
      expect(
        words.auditValue('activities', 'form_key', 'probe.interim_protocol', withTemplate),
      ).toBe('Protokoll der Zwischenprüfung')
    })

    // The log holds `{"stops": 5, "firefighters_lift": false}` (#263).
    it('write what an asset holds beyond its fields as its file does', () => {
      expect(
        words.auditValue('assets', 'values', '{"stops": 5, "firefighters_lift": false}', page),
      ).toBe('Feuerwehraufzug: Nein, Haltestellen: 5')
      // A key no kind names stays a key, and an asset that holds nothing has no value.
      expect(words.auditValue('assets', 'values', '{"stops": 2, "colour": "rot"}', page)).toBe(
        'colour: rot, Haltestellen: 2',
      )
      expect(words.auditValue('assets', 'values', '{}', page)).toBeNull()
      // Another column of the asset, and the same name on another table, are left alone.
      expect(words.auditValue('assets', 'name', '{"stops": 5}', page)).toBe('{"stops": 5}')
      expect(words.auditValue('rooms', 'values', '{"stops": 5}', page)).toBe('{"stops": 5}')
    })

    it('write every other key of the catalogue as what it is called', () => {
      expect(words.auditValue('assets', 'kind', 'probe.pump', page)).toBe('Druckerhöhungsanlage')
      expect(words.auditValue('asset_kind_names', 'kind', 'probe.pump', page)).toBe(
        'Druckerhöhungsanlage',
      )
      expect(words.auditValue('activities', 'form_key', 'probe.interim_protocol', page)).toBe(
        'Protokoll der Zwischenprüfung',
      )
      expect(words.auditValue('round_templates', 'source_key', 'probe.weekly_round', page)).toBe(
        'Rundgang durch die Technikzentrale',
      )
      expect(words.auditValue('defects', 'defect_class', 'probe.severe', page)).toBe('schwer')
      expect(words.recordTitle('defect_class_terms', 't-1', page)).toBe('schwer')
    })

    // The log holds a key and no version beside it.
    it('call a key by its newest version', () => {
      expect(words.auditValue('assets', 'kind', 'probe.elevator', page)).toBe('Aufzug')
    })

    it('leave a key standing that the catalogue does not hold', () => {
      expect(words.recordTitle('duties', 'd-3', page)).toBe('probe.long_gone')
      expect(words.auditValue('assets', 'kind', 'probe.long_gone', page)).toBe('probe.long_gone')
    })

    // The log holds whatever was written, and the words of the catalogue
    // hold nothing but their entries.
    it('have no word for a value called like what every object carries', () => {
      for (const raw of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        expect(words.auditValue('duties', 'kind', raw, page)).toBe(raw)
        expect(words.auditValue('assets', 'kind', raw, page)).toBe(raw)
        expect(words.auditValue('activities', 'form_key', raw, page)).toBe(raw)
        expect(words.auditValue('round_templates', 'source_key', raw, page)).toBe(raw)
        expect(words.auditValue('defects', 'defect_class', raw, page)).toBe(raw)
      }
    })

    it('keep the words of the lists on the same tables', () => {
      const values = auditScreenWordsWith(catalogueOf(testCatalogue)).values

      for (const table of ['activities', 'assets', 'defects', 'duties'] as const) {
        expect(values?.[table]).toMatchObject(auditValues[table] ?? {})
      }

      expect(words.auditValue('duties', 'basis', 'manufacturer', page)).toBe(
        'Vorgabe des Herstellers',
      )
    })

    it('are the words without it on a device that holds no catalogue yet', () => {
      expect(auditScreenWordsWith(null)).toBe(auditScreenWords)
      expect(auditWords(auditScreenWords).recordTitle('duties', 'd-1', page)).toBe(
        'probe.elevator_main_test',
      )
    })
  })

  // The log holds `{1,3}`, and the Leitung reads the days.
  it('write the days a plan walks its round on by their names (#259)', () => {
    const words = auditWords(auditScreenWords)

    expect(
      words.auditValue('round_plans', 'weekdays', '{1,3}', { titles: {}, people: {}, devices: {} }),
    ).toBe('Montag, Mittwoch')
  })

  // The log holds `{school,assembly}`, and the Leitung reads what the form
  // offered.
  it('write the kinds of a building in the words of the form', () => {
    const kinds = auditScreenWords.lists?.['kinds']

    expect(kinds?.['school']).toBe('Schule oder Hochschule')
    expect(kinds?.['assembly']).toBe('Versammlungs- oder Sportstätte')
    expect(kinds?.['other']).toBe('Sonstiges Gebäude')
  })

  it('open a property on its page, under words of its own', () => {
    expect(auditScreenWords.href?.('properties', 'p-1')).toBe('/liegenschaften/p-1')
    expect(auditScreenWords.linkWords?.('properties')).toBe('Zur Liegenschaft')
  })

  it('open a building, a floor and a room on their pages, each under words of its own', () => {
    expect(auditScreenWords.href?.('buildings', 'b-1')).toBe('/gebaeude/b-1')
    expect(auditScreenWords.linkWords?.('buildings')).toBe('Zum Gebäude')
    expect(auditScreenWords.href?.('floors', 'f-1')).toBe('/geschosse/f-1')
    expect(auditScreenWords.linkWords?.('floors')).toBe('Zum Geschoss')
    expect(auditScreenWords.href?.('rooms', 'r-1')).toBe('/raeume/r-1')
    expect(auditScreenWords.linkWords?.('rooms')).toBe('Zum Raum')
  })

  // The log names a board and not its asset; the address hands on to the page under it (#349).
  it('open a board by its id alone, which hands on to its page under the asset', () => {
    expect(auditScreenWords.href?.('distribution_boards', 'd-1')).toBe('/verteiler/d-1')
    expect(auditScreenWords.linkWords?.('distribution_boards')).toBe('Zum Verteiler')
  })

  // The log of a property takes in the people to talk to there, the log of a
  // building the times it is closed, and each says so beside the chip of the
  // record; every record the vocabulary gives parts has words for them.
  it('say what the log of a record takes in, for every record that takes something in', () => {
    expect(auditScreenWords.partsWords).toEqual({
      properties: 'mit ihren Ansprechpartnern',
      buildings: 'mit seinen Schließzeiten',
      rooms: 'mit seinen Etiketten',
      assets:
        'mit ihrem Lebenszyklus, dem, was sie versorgt, ihren Etiketten, ihren Verteilern und bei einem Zähler seinen Ständen',
      // The electrical structure below a low-voltage installation (#349).
      distribution_boards: 'mit seinen Feldern und Stromkreisen',
      circuits: 'mit seinen Betriebsmitteln',
      attachments: 'mit seinen Fassungen',
      activities:
        'mit den Pflichten, die er erfüllen soll, den Antworten auf sein Formular und bei einem Auftrag dessen Angaben und Beteiligten',
      defects: 'mit seinen Fotos',
      round_templates: 'mit ihren Fassungen',
    })
    expect(Object.keys(auditScreenWords.partsWords ?? {})).toEqual(
      Object.keys(auditVocabulary.parts),
    )
    expect(auditVocabulary.parts).toEqual({
      properties: [{ table: 'contacts', column: 'property_id' }],
      buildings: [{ table: 'building_closures', column: 'building_id' }],
      // A label is made and blocked on the page of what it hangs on (#98).
      rooms: [{ table: 'labels', column: 'room_id' }],
      assets: [
        { table: 'asset_lifecycle', column: 'asset_id' },
        { table: 'asset_supplies', column: 'asset_id' },
        { table: 'labels', column: 'asset_id' },
        // A meter with what its measuring point carries and its readings (#119).
        { table: 'meter_points', column: 'asset_id' },
        { table: 'meter_readings', column: 'asset_id' },
        { table: 'meter_exchanges', column: 'asset_id' },
        { table: 'meter_pauses', column: 'asset_id' },
        // A low-voltage installation with its boards (#349).
        { table: 'distribution_boards', column: 'asset_id' },
      ],
      distribution_boards: [
        { table: 'board_sections', column: 'distribution_board_id' },
        { table: 'circuits', column: 'distribution_board_id' },
      ],
      circuits: [{ table: 'equipment', column: 'circuit_id' }],
      attachments: [{ table: 'attachment_versions', column: 'attachment_id' }],
      // An activity with the duties it is to meet and what came of each (#105),
      // the answers to the points of its form (#106), and the notes on a
      // work order (#118).
      activities: [
        { table: 'activity_duties', column: 'activity_id' },
        { table: 'activity_answers', column: 'activity_id' },
        { table: 'work_orders', column: 'activity_id' },
        { table: 'work_order_participants', column: 'activity_id' },
        { table: 'work_order_notes', column: 'activity_id' },
        { table: 'service_reports', column: 'activity_id' },
        // The material taken for a work order (#326).
        { table: 'work_order_materials', column: 'activity_id' },
        { table: 'briefings', column: 'activity_id' },
        { table: 'work_permits', column: 'activity_id' },
      ],
      // A defect with its photos (#116).
      defects: [{ table: 'attachments', column: 'defect_id' }],
      // A template of a round with its versions (#112).
      round_templates: [{ table: 'round_template_versions', column: 'template_id' }],
    })
  })

  it('open nothing for a record without a screen, whatever it is called', () => {
    for (const table of ['building_closures', 'contacts', 'areas', 'constructor', 'toString']) {
      expect(auditScreenWords.href?.(table, 'x')).toBeNull()
      expect(auditScreenWords.linkWords?.(table)).toBeNull()
    }
  })

  // The button "Änderungen" stands at a record the vocabulary names as one.
  it('have the log opened from every record that has a page', () => {
    const paged = auditVocabulary.records.filter(
      (table) => auditScreenWords.href?.(table, 'x') !== null,
    )

    expect(paged).toEqual([
      'properties',
      'buildings',
      'floors',
      'rooms',
      'assets',
      'distribution_boards',
      'duties',
      'attachments',
      'activities',
      'defects',
      'round_templates',
      'round_plans',
      'fault_reports',
      'own_asset_kinds',
    ])
    expect(auditVocabulary.records).toEqual([
      'properties',
      'buildings',
      'floors',
      'rooms',
      'assets',
      'distribution_boards',
      'duties',
      'attachments',
      'activities',
      'defects',
      'round_templates',
      'round_plans',
      'fault_reports',
      'own_asset_kinds',
    ])
  })

  // A record that opens on a page says where the link leads.
  it('name the link of every record that opens on a page', () => {
    for (const table of auditVocabulary.records) {
      expect(auditScreenWords.linkWords?.(table)).not.toBeNull()
    }
  })
})
