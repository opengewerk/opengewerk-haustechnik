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
