// The public surface of the package. Server and interface import from here
// and never from a file below.
//
// What every application of the organisation shares sits in the foundation
// (ADR 0010 in the repository opengewerk) and is handed on from here, so that
// server and interface of this application ask one package, whichever of the
// two a name comes from.
export * from '@opengewerk/platform-domain'

// What this application names where a mechanism of the foundation needs a
// list: the sequences its numbers are drawn from, and what a tenant hands it
// to keep sealed.
export * from './model/number-range.js'
export * from './model/secret.js'

// What a message of an operator is signed with, and the occasions a person
// gets as push on their devices.
export * from './model/mail-signature.js'
export * from './model/push.js'

// What somebody may do with what a tenant keeps, the roles a tenant starts
// with, and what a tenant may be called.
export * from './model/rights.js'
export * from './model/tenant.js'

// Where somebody may do it: the areas a tenant bundles its properties in, and
// who stands in for whom.
export * from './model/area.js'

// The place: properties, buildings, floors and rooms, and what a record that
// belongs to a place hangs on.
export * from './model/location.js'
export * from './model/target.js'

// Names in the order a German list sorts them, a number in a name by its
// value, for every list of the interface and the server alike.
export * from './model/name-order.js'

// The people to talk to at a property: the contacts of the foundation, with
// what one hangs on here and how long its texts may be.
export * from './model/contact.js'

// The times a building is closed, in which no round is made for it.
export * from './model/closure.js'
export * from './model/holiday.js'

// The documents of an operator: the files of the foundation, with what one
// hangs on here and what kind of document it is.
export * from './model/document.js'

// The tasks of an operator: the task of the foundation, at a place, an asset
// or an activity (#124).
export * from './model/task.js'

// The labels with a QR code on assets and rooms: the label of the foundation,
// with what one hangs on here and what a scan of one says.
export * from './model/label.js'

// The technology: assets, their components, life cycle and meters.
export * from './model/asset.js'
// Whether an asset may already stand in the register, and the general kind
// of a cost group.
export * from './model/asset-duplicate.js'
// The exchange of an asset: what it asks, when it is refused and what ends
// with the asset that goes.
export * from './model/asset-exchange.js'
export * from './model/meter.js'
export * from './model/meter-reading.js'
export * from './model/meter-register.js'
export * from './model/cost-group.js'

// The import of places and assets from a table: the plan of what its lines
// would make, held against what is there, and what a list calls the asset
// kinds.
export * from './model/floor-level.js'
export * from './model/import.js'
export * from './model/import-structure.js'
export * from './model/import-assets.js'
export * from './model/import-deadlines.js'
export * from './model/import-meters.js'
export * from './model/import-templates.js'
// What only an asset kind has, between a form or a column of a list and the
// asset: the fields a kind brings, and a cell read as one of them.
export * from './model/asset-values.js'
export * from './model/import-kind-fields.js'

// The catalogue the packages under pakete/ make up: asset kinds, duty kinds
// and their rules, each with its review, and the questions asked of it.
export * from './model/catalogue.js'

// The duties of a tenant: when one falls due next and what state it is in on
// a day, and the evidence of what was done, with its frozen state, the
// canonical form its fingerprint is taken over and who signs it.
export * from './model/duty.js'
export * from './model/duty-record.js'
export * from './model/canonical.js'
export * from './model/evidence.js'
export * from './model/signature.js'
export * from './model/service-report.js'
// The stores, on the building block of the foundation (#325).
export * from './model/store.js'
// The contractors of the operator, tenant-wide (#328).
export * from './model/contractor.js'
export * from './model/material.js'

// What is done to meet a duty or to set a fault right, and what is noticed on
// the way: activities with the duties they meet, the answers to their forms
// and their work orders, and defects.
export * from './model/activity.js'
export * from './model/answer.js'
// The templates of the rounds an operator keeps in the office, with their
// versions, and the point that fulfils a duty.
export * from './model/round-plan.js'
export * from './model/round-record.js'
export * from './model/round-template.js'
export * from './model/activity-register.js'
export * from './model/work-order-register.js'
export * from './model/defect.js'
export * from './model/defect-register.js'

// What the duties and the defects of an asset say about it, taken together,
// and the register and the file of an asset as a screen reads them.
export * from './model/asset-condition.js'

// The register of duties and the page of a duty as a screen reads them, with
// the order of the register and what an evidence means for an appointment.
export * from './model/duty-register.js'
// What the register, the page of a duty and the register as a table say
// about a duty in the same words.
export * from './model/duty-words.js'
// The document that bears the interval of a duty, and when a duty says
// "Frist prüfen".
export * from './model/duty-document.js'

// The proposals of the catalogue for an asset, worked out each time they are
// read, and the batch that confirms or dismisses many of them at once.
export * from './model/duty-proposal.js'
// What a new version of a package means for a duty that is confirmed, and
// the two decisions about it: taking it over, or leaving the duty as it is.
export * from './model/duty-update.js'

// The overview of the operator's responsibility, the start page of the office.
export * from './model/overview.js'

// The lists of the office as tables: their columns and the words in them,
// shared by the list on the screen and the route that writes its table.
export * from './model/office-table.js'

// The timeline of a place: what happened there and below it, the newest first.
export * from './model/timeline.js'

// The search by name, number and mark over places, assets, activities and
// the evidence, on the server and on the device.
export * from './model/search.js'

// The page of an evidence, the evidence of an asset and what a correction
// of an evidence has to say.
export * from './model/evidence-page.js'

// The report of a contractor or an inspection body, as the office enters it
// to become the evidence of a duty.
export * from './model/report.js'

// The deadlines of this application: the kinds the deadline engine of the
// foundation keeps, with their sources and actions.
export * from './model/deadlines.js'

// The forms of this application: the form engine of the foundation, bound to
// its units, the kinds of field it shows and the records a field may be
// about. The types bound to its terms carry the names of the general ones of
// the foundation, so they are named here once more, and these win.
export * from './model/forms.js'
export type {
  BlockField,
  FormDefinition,
  FormField,
  FormSection,
  FormTerms,
  GroupField,
  MeasurementField,
  MeterReadingField,
  NumberField,
} from './model/forms.js'

// What a device may create, change and hold, and the rules server and device
// decide an operation by.
export * from './model/sync.js'

// What the change log calls the tables of this application, and the words the
// foundation takes from it for its own.
export * from './model/asset-value-words.js'
export * from './model/audit.js'

// The paths the server of this application answers itself.
export * from './model/server-paths.js'
