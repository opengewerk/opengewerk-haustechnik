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
  },
})
