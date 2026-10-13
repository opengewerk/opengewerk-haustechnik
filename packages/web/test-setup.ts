import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// How long `findBy...` and `waitFor` wait for what a test names, ten seconds
// where Testing Library gives up after one (#277). They return as soon as it
// is there, so a longer limit costs a green test nothing; it is only how long
// a red one takes to say so. The one second is too short on a machine whose
// cores are all taken: a screen that is mounted, takes its records from the
// device and draws needs several turns of the event loop, and such a machine
// hands those out slowly. A test that waits for something not to come names a
// short limit of its own.
configure({ asyncUtilTimeout: 10_000 })

// Testing Library only tears the document down by itself when vitest runs with
// globals, and this repository keeps those off. Without it the second render
// in a file lands next to the first, and a query finds two buttons where the
// test meant one.
afterEach(cleanup)

// A request no test answers goes nowhere. The tests stub `fetch` with
// `vi.stubGlobal`, and `vi.unstubAllGlobals()` hands back what was there
// before: without this the real `fetch` of happy-dom, which would go out on
// the network. Refused here the way a network that is down refuses, with a
// TypeError, so that the application reads it as no connection.
globalThis.fetch = ((input: RequestInfo | URL) =>
  Promise.reject(
    new TypeError(`Kein Netz in Tests: ${input instanceof Request ? input.url : String(input)}`),
  )) as typeof fetch
