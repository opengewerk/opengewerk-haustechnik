import { BadRequestException } from '@nestjs/common'

// What the registers share in reading an address: a part of it as text, and a
// whole number within its bounds. The register of assets and the register of
// duties are both asked a page at a time and narrowed by what the address
// names.

/** A part of the address as text, and nothing for one that is empty or said twice. */
export function said(query: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = query[name]

  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A whole number of the address within its bounds, or the refusal. */
export function counted(
  value: string | undefined,
  fallback: number,
  bounds: { readonly least: number; readonly most: number },
  refusal: string,
): number {
  if (value === undefined) {
    return fallback
  }

  const number = Number(value)

  if (!/^\d+$/.test(value) || number < bounds.least || number > bounds.most) {
    throw new BadRequestException(refusal)
  }

  return number
}
