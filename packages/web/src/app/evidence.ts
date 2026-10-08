import type { AssetEvidenceEntry } from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'

/** The evidence of an asset, the newest first, for its file and its page on site. */
export function assetEvidenceQuery(id: string) {
  return {
    queryKey: ['assets', 'evidence', id],
    queryFn: () => request<AssetEvidenceEntry[]>(`/assets/${id}/evidence`),
  } as const
}
