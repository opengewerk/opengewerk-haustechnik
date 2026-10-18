import { importedTables, type ImportOrigin } from '@opengewerk/haustechnik-domain'
import { date } from '@opengewerk/platform-web/format'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Upload } from 'lucide-react'

import { importPage, importReadings } from './import-addresses.js'

export const importOriginWords = {
  link: 'Zum Import',
} as const

/** What one of the five tables an import writes asks about a record, and nothing for any other. */
function isImported(table: string): boolean {
  return (importedTables as readonly string[]).includes(table)
}

/**
 * Over the log of a record (#174), `protokoll_aus_import()` of the boards of
 * the settings: the import that made it, with its day and its file and the
 * way to its page. No change of the log says so, since an import writes one
 * entry in the place of one for every record it makes (#100). A record made
 * by hand or on site has nothing here, and neither has a record of a table
 * no import writes, which is not asked about.
 */
export function ImportOriginLead({ table, id }: { readonly table: string; readonly id: string }) {
  const asked = isImported(table)
  const origin = useQuery({
    queryKey: ['imports', 'origin', table, id],
    // An answer of nothing comes as an empty body, which a query may not hold.
    queryFn: async () =>
      (await request<ImportOrigin | null | undefined>(importReadings.origin(table, id))) ?? null,
    enabled: asked,
  })
  const found = asked ? (origin.data ?? null) : null

  if (found === null) {
    return null
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-muted">
      <Upload size={16} strokeWidth={2.1} aria-hidden="true" className="shrink-0" />
      <span>
        Angelegt mit dem Import vom{' '}
        <strong className="font-semibold text-ink">{date(found.importedOn)}</strong>, Datei{' '}
        {found.fileName}.
      </span>
      <Link to={importPage(found.importId)} className="text-[13px]">
        {importOriginWords.link}
      </Link>
    </p>
  )
}
