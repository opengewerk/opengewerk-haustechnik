import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'

/** The JSON of a bundle and the module that hands it on with its type. */
function moduleOf(
  bundle: CatalogueBundle,
  names: { readonly json: string; readonly module: string; readonly constant: string },
  origin: string,
): Readonly<Record<string, string>> {
  return {
    [names.json]: `${JSON.stringify(bundle)}\n`,
    [`${names.module}.js`]: [
      `// Written by the build of @opengewerk/haustechnik-catalogue from ${origin}.`,
      '// A change belongs in the packages; the build writes this file again.',
      `import bundle from './${names.json}' with { type: 'json' }`,
      '',
      `export const ${names.constant} = bundle`,
      '',
    ].join('\n'),
    [`${names.module}.d.ts`]: [
      '// Written by the build of @opengewerk/haustechnik-catalogue.',
      "import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'",
      '',
      `export declare const ${names.constant}: CatalogueBundle`,
      '',
    ].join('\n'),
  }
}

/**
 * What the build writes into dist/ for the catalogue: the bundle, and the
 * module that hands it on with its type, so that server and interface import
 * one package and load the same file (ADR 0005, point 4).
 */
export function bundleFiles(bundle: CatalogueBundle): Readonly<Record<string, string>> {
  return moduleOf(
    bundle,
    { json: 'catalogue.json', module: 'index', constant: 'catalogueBundle' },
    'the folder pakete/',
  )
}

/**
 * The same for the probe package, under the entry `./testing`: the catalogue
 * the tests of the server load for what the real one does not hold yet. It is no
 * part of the catalogue a server loads, and nothing outside a test imports it.
 */
export function probeFiles(bundle: CatalogueBundle): Readonly<Record<string, string>> {
  return moduleOf(
    bundle,
    { json: 'probe.json', module: 'testing', constant: 'probeCatalogueBundle' },
    'the probe package in test/pakete/',
  )
}
