import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBudgets } from '@opengewerk/platform-web/tools/budget'

import { unprecachedScripts } from './precached.js'

/**
 * The budgets of this application's two entry points, measured by the
 * foundation's tool against the build (ADR 0004 and ADR 0010 in the
 * repository opengewerk).
 *
 * The figures are the ones of the Handwerkersoftware: 300 kB for the entry on
 * site, from ADR 0004, and a ceiling of 450 kB for the office, which catches a
 * careless import. Raising one is a decision worth a sentence in the pull
 * request, which is the whole point of having it.
 */
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

checkBudgets({
  dist,
  budgets: [
    { name: 'Vor Ort', document: 'm/index.html', limit: 300 * 1024 },
    { name: 'Büro', document: 'index.html', limit: 450 * 1024 },
  ],
})

// The screens of the office are fetched with their address (#374): a page of
// one version opens them from its service worker until it takes the next one
// over, so the worker has to hold every script of the build.
const missing = unprecachedScripts(dist)

if (missing.length > 0) {
  console.error(
    `Diese Skripte hält der Service Worker nicht, ein Bildschirm daraus öffnet sich nach der nächsten Fassung nicht mehr: ${missing.join(', ')}`,
  )
  process.exitCode = 1
} else {
  console.log('Jedes Skript des Baus hält der Service Worker.')
}
