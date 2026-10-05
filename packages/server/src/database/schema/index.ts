// What every application of the organisation carries comes from the
// foundation (ADR 0010 in the repository opengewerk): the role the policies
// are written for, and the tables for tenants, accounts, memberships, roles,
// the audit log, the sync layer and the instance. They are handed on here
// because drizzle-kit reads the schema from this file: a table it does not
// find here is one it would drop, a role one it would try to manage.
export * from '@opengewerk/platform-server/schema'

// Tables of the foundation this application makes with lists of its own.
export * from './number-ranges.js'
export * from './secrets.js'

// The tables of this application.
export * from './areas.js'
export * from './locations.js'
export * from './contacts.js'
export * from './closures.js'
export * from './assets.js'
export * from './duties.js'
export * from './evidence-result.js'
export * from './evidence.js'
export * from './activities.js'
export * from './defects.js'
export * from './signatures.js'
export * from './deadlines.js'
