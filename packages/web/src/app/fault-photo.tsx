import { requestFile } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

/**
 * The photo of a fault report (#331), fetched like every other request, with
 * the session and the tenant the page works in: an address in an image would
 * reach the server without the tenant. The page shows it from the bytes and
 * lets the address go when it is left.
 */
export function useFaultPhoto(path: string | null): string | null {
  const photo = useQuery({
    queryKey: ['fault-reports', 'photo', path],
    queryFn: async () => (await requestFile(path ?? '', 'image/*')).content,
    enabled: path !== null,
    staleTime: Infinity,
  })
  const content = photo.data
  const address = useMemo(
    () => (content === undefined ? null : URL.createObjectURL(content)),
    [content],
  )

  useEffect(
    () => () => {
      if (address !== null) {
        URL.revokeObjectURL(address)
      }
    },
    [address],
  )

  return address
}

/** The photo of a report, or nothing while it comes. */
export function FaultPhoto({
  path,
  alt,
  className,
}: {
  readonly path: string
  readonly alt: string
  readonly className: string
}) {
  const address = useFaultPhoto(path)

  return address === null ? null : <img src={address} alt={alt} className={className} />
}
