import { writeFileSync } from 'node:fs'

import { describeProcessing } from '@opengewerk/haustechnik-domain'

import { processingTemplate } from './template.js'

// Writes the description of the processing with the defaults into the
// repository (#357): `pnpm --filter @opengewerk/haustechnik-server run
// describe` after a change to the template. A test holds the file and the
// template equal, character for character.

const target = new URL(
  '../../../../docs/verfahrensbeschreibung/Verfahrensbeschreibung.md',
  import.meta.url,
)

writeFileSync(target, describeProcessing(processingTemplate(), null), 'utf8')
console.log('Die Verfahrensbeschreibung mit den Vorgaben ist geschrieben.')
