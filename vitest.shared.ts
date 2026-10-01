// One base for every package, and the same one the foundation tests with: the
// file pattern, no globals, mocks cleared between tests. Handed on from here so
// that the path into the submodule is written down once.
export { shared, shared as default } from './upstream/opengewerk/vitest.shared.js'
