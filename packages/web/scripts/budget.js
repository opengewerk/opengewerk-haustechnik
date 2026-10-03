import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBudgets } from '@opengewerk/platform-web/tools/budget'

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
checkBudgets({
  dist: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  budgets: [
    { name: 'Vor Ort', document: 'm/index.html', limit: 300 * 1024 },
    { name: 'Büro', document: 'index.html', limit: 450 * 1024 },
  ],
})
