import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'

export type BundleFile = 'catalogue.json' | 'index.js' | 'index.d.ts'

/**
 * What the build writes into dist/: the bundle, and the module that hands it
 * on with its type, so that server and interface import one package and load
 * the same file (ADR 0005, point 4).
 */
export function bundleFiles(bundle: CatalogueBundle): Readonly<Record<BundleFile, string>> {
  return {
    'catalogue.json': `${JSON.stringify(bundle)}\n`,
    'index.js': [
      '// Written by the build of @opengewerk/haustechnik-catalogue from the folder pakete/.',
      '// A change belongs in the packages; the build writes this file again.',
      "import bundle from './catalogue.json' with { type: 'json' }",
      '',
      'export const catalogueBundle = bundle',
      '',
    ].join('\n'),
    'index.d.ts': [
      '// Written by the build of @opengewerk/haustechnik-catalogue.',
      "import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'",
      '',
      'export declare const catalogueBundle: CatalogueBundle',
      '',
    ].join('\n'),
  }
}
