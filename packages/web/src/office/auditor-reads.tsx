import type { AuditorRead, AuditorReadList } from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, TablePanel } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import { request } from '@opengewerk/platform-web/sync'
import { useInfiniteQuery } from '@tanstack/react-query'

/**
 * "Zugriffe von Prüfern" under "Zugänge" (#339, the board of "Zugänge" with an auditor):
 * every request an auditor from outside made, newest first, with when, who and
 * what in words. Nothing where no auditor read anything.
 */

export const auditorReadWords = {
  title: 'Zugriffe von Prüfern',
  caption: 'Zugriffe von Prüfern mit Zeitpunkt, Prüfer und was',
  note: 'Jede Anfrage eines Prüfers steht hier, mit Zeitpunkt und was er gesehen oder ausgegeben hat. Ändern kann er nichts.',
  more: 'Weitere laden',
} as const

const readsQueryKey = ['auditor-reads'] as const

export function AuditorReadsCard() {
  const reads = useInfiniteQuery({
    queryKey: readsQueryKey,
    queryFn: ({ pageParam }) =>
      request<AuditorReadList>(
        pageParam === null
          ? '/auditor-reads'
          : `/auditor-reads?before=${encodeURIComponent(pageParam)}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.more ? (last.reads.at(-1)?.readAt ?? null) : null),
  })
  const rows: readonly AuditorRead[] = reads.data?.pages.flatMap((page) => page.reads) ?? []

  if (rows.length === 0) {
    return null
  }

  const what = (read: AuditorRead) =>
    read.subject === null ? read.what : `${read.what}: ${read.subject}`

  return (
    <TablePanel
      title={auditorReadWords.title}
      caption={auditorReadWords.caption}
      grow={false}
      note={auditorReadWords.note}
      cards={rows.map((read) => ({
        key: read.id,
        title: what(read),
        sub: [moment(read.readAt), read.personName].join(' · '),
      }))}
      {...(reads.hasNextPage
        ? {
            footer: (
              <Button
                size="small"
                disabled={reads.isFetchingNextPage}
                onClick={() => {
                  void reads.fetchNextPage()
                }}
              >
                {auditorReadWords.more}
              </Button>
            ),
          }
        : {})}
    >
      <thead>
        <tr>
          <Column className="w-[150px] min-w-[140px]">Zeitpunkt</Column>
          <Column className="w-[170px] min-w-[140px]">Prüfer</Column>
          <Column className="min-w-[220px]">Was</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((read) => (
          <tr key={read.id}>
            <Cell>{moment(read.readAt)}</Cell>
            <Cell>{read.personName}</Cell>
            <Cell>{what(read)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
