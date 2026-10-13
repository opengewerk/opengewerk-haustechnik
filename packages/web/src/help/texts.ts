import { readMarkdown } from '@opengewerk/platform-web'

/**
 * The texts of the help (#131), as they lie under `packages/web/help`:
 *
 * - `office/` a text for a page of the office, named after its address
 *   (`liegenschaften.md` for `/liegenschaften`, `index.md` for `/`),
 * - `site/` a text for a screen on site, named the same way,
 * - `guides/` the quick guides to the core flows of section 1 of the concept,
 * - `manual/` the manual for whoever runs the instance.
 *
 * They are Markdown in the part the foundation reads (`Markdown` of
 * `@opengewerk/platform-web`) and are built into the application, so that
 * they are read on site without a network. Each folder is a module of its
 * own that is loaded when somebody opens the help, and no part of what a
 * screen loads first: the budget of the entry on site stays what it is.
 *
 * Inside the package and not under `docs/`: the build of the image leaves
 * `docs/` out (`.dockerignore`), and a text the build does not find is
 * missing without a word.
 */

/** The texts of a folder by their key: the path below the folder, without the ending. */
export function byKey(
  found: Readonly<Record<string, string>>,
  folder: string,
): ReadonlyMap<string, string> {
  const marker = `/help/${folder}/`

  return new Map(
    Object.entries(found).map(([path, text]) => [
      path.slice(path.indexOf(marker) + marker.length).replace(/\.md$/, ''),
      text,
    ]),
  )
}

/** The quick guides, in the order the concept names its core flows. */
export const guideOrder = [
  'rundgang',
  'bestandsaufnahme',
  'pruefung-mit-bericht',
  'vom-mangel-zum-auftrag',
  'ablesung',
] as const

/** The chapters of the manual, in the order somebody who sets up an instance needs them. */
export const manualOrder = ['installation', 'update', 'sicherung', 'betreiber-anlegen'] as const

/** The texts of the screens on site, in the order of its tabs and then its menu. */
export const siteHelpOrder = ['index', 'scannen', 'aufnehmen', 'konflikte', 'aufgaben'] as const

/** The first paragraph of a text in plain words, for the line under its title in a list. */
export function firstParagraph(source: string): string {
  const paragraph = readMarkdown(source).find((block) => block.kind === 'paragraph')

  return paragraph?.kind === 'paragraph' ? paragraph.line.map((piece) => piece.text).join('') : ''
}

/** The texts of a folder in their order, each with its key; one that is missing is left out. */
export function inOrder(
  texts: ReadonlyMap<string, string>,
  order: readonly string[],
): readonly { readonly key: string; readonly text: string }[] {
  return order.flatMap((key) => {
    const text = texts.get(key)

    return text === undefined ? [] : [{ key, text }]
  })
}
