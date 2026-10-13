import react from '@vitejs/plugin-react'
import { mergeConfig } from 'vitest/config'
import { shared } from '../../vitest.shared.js'

export default mergeConfig(shared, {
  plugins: [react()],
  test: {
    name: 'web',
    // The scripts beside the source run in Node, and so do their tests, each
    // of which says so at its top.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.js'],
    setupFiles: ['./test-setup.ts'],
    environment: 'happy-dom',
    // Thirty seconds for a test where vitest stops one after five (#277). A
    // test that fills in a form waits a turn of the event loop for every key,
    // well over a hundred of them, and takes under half a second on a quiet
    // machine; with every core taken, each of those turns waits for its
    // share, and the same test ran past five seconds. Stopped there, it went
    // on typing into the form of the next test, which then failed as well,
    // with letters it had not typed. Above the limit of a single wait
    // (`test-setup.ts`), so that a wait says what it missed before the test
    // is stopped without a word.
    testTimeout: 30_000,
  },
})
