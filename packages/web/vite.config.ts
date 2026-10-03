import { foundationPaths, serverPaths } from '@opengewerk/haustechnik-domain'
import { entryManifests } from '@opengewerk/platform-web/tools/manifests'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { applicationName } from './src/app/name.js'
import { icons, officeWords, siteWords } from './src/entry/manifest.js'

export default defineConfig({
  // `assets` at the root of the repository rather than a folder of this
  // package: the brand files are copied into this repository once, from the
  // organisation repository, and a second copy here would be a third place to
  // forget.
  publicDir: '../../assets',

  build: {
    // Two entry points, two bundles. This is what makes the budget per entry
    // mean anything: the entry for the work on site does not carry the
    // office's tables, and a check on one number for both would hide exactly
    // that.
    rollupOptions: {
      input: {
        office: 'index.html',
        site: 'm/index.html',
      },
    },
    // The budget is checked against the gzipped size in `scripts/budget.js`,
    // so vite's own warning about raw bytes would only be noise next to it.
    chunkSizeWarningLimit: 2000,
  },

  server: {
    // In development vite serves the two entry points and the API is somewhere
    // else, so every path the server owns is forwarded to it, on the port of
    // this application (ADR 0001). The list is the one the server and the
    // service worker take as well, the foundation's and this application's.
    proxy: Object.fromEntries(
      [...foundationPaths, ...serverPaths].map((path) => [
        `/${path}`,
        { target: 'http://127.0.0.1:23800', changeOrigin: false },
      ]),
    ),
  },

  plugins: [
    react(),
    tailwind(),
    // Both manifests, and the name in the title of both shells and in their
    // sentence for a browser without JavaScript (ADR 0010).
    entryManifests({ name: applicationName, icons, office: officeWords, site: siteWords }),
    VitePWA({
      // Hand written, because the fallback for a navigation has to be told
      // apart by prefix: `/m/...` belongs to the shell of the work on site and
      // everything else to the office shell. A generated worker knows one
      // fallback.
      strategies: 'injectManifest',
      srcDir: 'src/entry',
      filename: 'service-worker.ts',
      // Nothing is swapped under somebody who is filling in a form. The new
      // version waits and the application offers it.
      registerType: 'prompt',
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
      },
      devOptions: {
        // Off in development on purpose: a service worker that keeps serving
        // the previous build is the most confusing thing that can happen
        // while working on the interface.
        enabled: false,
      },
    }),
  ],
})
