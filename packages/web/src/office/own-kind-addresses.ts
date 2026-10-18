import {
  ownPackage,
  type AssetField,
  type Catalogue,
  type ExpectedDocument,
  type OwnFieldSort,
  type OwnKindsReading,
} from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the asset kinds and fields of the operator's own live in the office
 * (#62): under "Katalog", beside the packages, and the routes of the server
 * they are kept at.
 */
export const ownKindPlaces = {
  list: '/katalog/eigen',
  fields: '/katalog/eigen/angaben',
  /**
   * The page of a kind, by its key without `eigen.`: the server reads a last
   * part with a point as a file and hands no page back for it, as the page of
   * a duty kind names its key without its package.
   */
  kind: (key: string): string =>
    `/katalog/eigen/arten/${encodeURIComponent(key.slice(key.indexOf('.') + 1))}`,
} as const

/** The key of an own kind from the last part of the address of its page. */
export function ownKindKeyOf(part: string): string {
  return `${ownPackage}.${part}`
}

export const ownKindRoutes = {
  list: '/own-kinds',
  kind: (id: string) => `/own-kinds/${encodeURIComponent(id)}`,
  fields: '/own-kinds/fields',
  field: (id: string) => `/own-kinds/fields/${encodeURIComponent(id)}`,
} as const

export const ownKindsKey = ['own-kinds'] as const

/** What the catalogue calls what the operator added, as a row beside its packages. */
export const ownPackageWords = {
  title: 'Eigene dieses Betreibers',
  under: 'Anlagenarten und Angaben',
  status: 'eigene',
} as const

export const ownKindsQuery = {
  queryKey: ownKindsKey,
  queryFn: () => request<OwnKindsReading>(ownKindRoutes.list),
} as const

/** An own field as the screens show it, with its id and what uses it where the reading of the server has them. */
export interface OwnFieldView {
  readonly id: string | null
  readonly assetKind: string
  readonly key: string
  readonly label: string
  readonly sort: OwnFieldSort
  readonly unit: string | null
  readonly options: readonly { readonly value: string; readonly label: string }[]
  /** How many assets hold a value of it, past the areas; null where only the catalogue was read. */
  readonly values: number | null
}

/** An own kind as the screens show it. */
export interface OwnKindView {
  readonly id: string | null
  readonly key: string
  readonly label: string
  readonly costGroup: string
  readonly fields: readonly OwnFieldView[]
  readonly documents: readonly ExpectedDocument[]
  /** How many assets carry it, past the areas; null where only the catalogue was read. */
  readonly assets: number | null
}

/** What the screens show of the operator's own: its kinds, and its fields at kinds of packages. */
export interface OwnView {
  readonly kinds: readonly OwnKindView[]
  readonly fields: readonly OwnFieldView[]
}

function fieldFrom(kind: string, field: AssetField): OwnFieldView {
  return {
    id: null,
    assetKind: kind,
    key: field.key,
    label: field.label,
    sort: field.kind,
    unit: field.kind === 'number' ? (field.unit ?? null) : null,
    options: field.kind === 'choice' ? field.options : [],
    values: null,
  }
}

/**
 * The own kinds and fields as whoever keeps them reads them from the server,
 * with ids and counts, or as everybody else reads them from the catalogue the
 * device holds.
 */
export function ownView(
  reading: OwnKindsReading | undefined,
  catalogue: Catalogue | null,
): OwnView {
  if (reading !== undefined) {
    return {
      kinds: reading.kinds.map((kind) => ({
        id: kind.id,
        key: kind.key,
        label: kind.label,
        costGroup: kind.costGroup,
        fields: kind.fields,
        documents: kind.expectedDocuments,
        assets: kind.assets,
      })),
      fields: reading.fields,
    }
  }

  const own = catalogue?.bundle.own

  return {
    kinds: (own?.assetKinds ?? []).map((entry) => ({
      id: null,
      key: entry.key,
      label: entry.definition.label,
      costGroup: entry.definition.costGroup,
      fields: entry.definition.fields.map((field) => fieldFrom(entry.key, field)),
      documents: entry.definition.expectedDocuments,
      assets: null,
    })),
    fields: Object.entries(own?.fields ?? {}).flatMap(([kind, fields]) =>
      fields.map((field) => fieldFrom(kind, field)),
    ),
  }
}
