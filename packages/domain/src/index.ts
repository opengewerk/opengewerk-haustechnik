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

// What somebody may do with what a tenant keeps, the roles a tenant starts
// with, and what a tenant may be called.
export * from './model/rights.js'
export * from './model/tenant.js'

// Where somebody may do it: the areas a tenant bundles its properties in, and
// who stands in for whom.
export * from './model/area.js'

// The place: properties, buildings, floors and rooms.
export * from './model/location.js'

// The technology: assets, their components, life cycle and meters.
export * from './model/asset.js'
export * from './model/meter.js'

// The catalogue the packages under pakete/ make up: asset kinds, duty kinds
// and their rules, each with its review, and the questions asked of it.
export * from './model/catalogue.js'

// The duties of a tenant: when one falls due next and what state it is in on
// a day, and the results of what was done, which decide whether it counts.
export * from './model/duty.js'
export * from './model/duty-record.js'
export * from './model/evidence.js'

// What a device may create, change and hold, and the rules server and device
// decide an operation by.
export * from './model/sync.js'

// What the change log calls the tables of this application, and the words the
// foundation takes from it for its own.
export * from './model/audit.js'

// The paths the server of this application answers itself.
export * from './model/server-paths.js'
