import { checkEntries } from '@opengewerk/platform-web/tools/entry-check'

/**
 * Both entries of this application in a real browser with the script of the
 * entry cut off, asked by the foundation's tool (ADR 0010 in the repository
 * opengewerk) against the preview (`pnpm run preview`, #29): the page loads
 * itself anew once, and says so where that does not help (#279). Until then
 * a page whose script did not arrive stayed empty and said nothing, which is
 * how the check of the widths met it (#275).
 */
await checkEntries({ entries: ['/', '/m/'] })
