import { type OwnLimits, ownLimitsInWords } from '@opengewerk/haustechnik-domain'
import { NoteBox } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'

import { useCatalogue } from '../sync/catalogue.js'
import { assetKindChoices } from './register-filter.js'

/**
 * Above the register of an auditor from outside (#339, the board `pflichten`
 * as an auditor sees it): until when, where and which kinds the access reads,
 * and that every access is written down. Nothing for anybody else.
 */
export const ownLimitsQuery = {
  queryKey: ['my-limits'],
  queryFn: () => request<OwnLimits>('/areas/my-limits'),
} as const

export function OwnLimitsNote() {
  const reads = useRight('duty.read')
  const own = useQuery({ ...ownLimitsQuery, enabled: reads })
  const kinds = assetKindChoices(useCatalogue())

  if (own.data === undefined || !own.data.auditor) {
    return null
  }

  return (
    <NoteBox tone="waiting">
      {ownLimitsInWords(own.data, (key) => kinds.find((kind) => kind.key === key)?.label ?? key)}
    </NoteBox>
  )
}
