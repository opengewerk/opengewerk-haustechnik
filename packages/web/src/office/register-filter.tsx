import type { Catalogue, RecordState } from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { text } from '@opengewerk/platform-web/sync'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId } from 'react'

/**
 * What the registers of the office are narrowed with, `select_filter()` of
 * the boards: a choice with its name above it, so that several side by side
 * say what they narrow; the place, a property or one of its buildings; and
 * the asset kinds of the catalogue by what they are called. The register of
 * assets and the register of duties are narrowed by the same two.
 */

/** One filter: its name, and a choice in the look of the filters of the foundation. */
export function RegisterFilter({
  label,
  value,
  onChange,
  className,
  children,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly className: string
  readonly children: ReactNode
}) {
  const id = useId()

  return (
    <div className={`flex flex-col gap-[3px] max-lg:w-full ${className}`}>
      <label htmlFor={id} className="text-[12px] text-ink-faint max-lg:text-[13px]">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          className="h-8 w-full cursor-pointer appearance-none rounded-control border border-line-strong bg-surface pr-7 pl-2.5 text-[13px] text-ink max-lg:h-10 max-lg:text-[15px]"
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-muted"
        />
      </div>
    </div>
  )
}

/** A property, or one building of a property, as a register is narrowed to it. */
export interface PlaceNarrowed {
  readonly propertyId?: string
  readonly buildingId?: string
}

/**
 * "Standort": every property with its buildings below it. A property stands
 * for all its buildings, a building for itself.
 */
export function PlaceFilter({
  place,
  properties,
  buildings,
  onPlace,
  className,
}: {
  readonly place: PlaceNarrowed
  readonly properties: readonly RecordState[]
  readonly buildings: readonly RecordState[]
  readonly onPlace: (place: PlaceNarrowed) => void
  readonly className: string
}) {
  const byName = (left: RecordState, right: RecordState) =>
    text(left, 'name').localeCompare(text(right, 'name'), 'de')
  const value =
    place.buildingId !== undefined
      ? `b:${place.buildingId}`
      : place.propertyId !== undefined
        ? `p:${place.propertyId}`
        : ''

  return (
    <RegisterFilter
      label="Standort"
      className={className}
      value={value}
      onChange={(chosen) => {
        onPlace(
          chosen.startsWith('b:')
            ? { buildingId: chosen.slice(2) }
            : chosen.startsWith('p:')
              ? { propertyId: chosen.slice(2) }
              : {},
        )
      }}
    >
      <option value="">Alle Liegenschaften</option>
      {[...properties].sort(byName).map((property) => (
        <optgroup key={String(property['id'])} label={text(property, 'name')}>
          <option value={`p:${String(property['id'])}`}>
            {text(property, 'name')}, alle Gebäude
          </option>
          {buildings
            .filter((building) => building['propertyId'] === property['id'])
            .sort(byName)
            .map((building) => (
              <option key={String(building['id'])} value={`b:${String(building['id'])}`}>
                {text(building, 'name')}
              </option>
            ))}
        </optgroup>
      ))}
    </RegisterFilter>
  )
}

/** An asset kind as a filter offers it. */
export interface KindChoice {
  readonly key: string
  readonly costGroup: string
  readonly label: string
}

/**
 * The asset kinds of the catalogue by what a kind is called. Two packages may
 * call a kind the same; then each says which package it is from, so that the
 * choice is one.
 */
export function assetKindChoices(catalogue: Catalogue | null): KindChoice[] {
  const entries = catalogue?.assetKinds(today()) ?? []
  const packageOf = (key: string) => {
    const name = key.slice(0, key.indexOf('.'))

    return catalogue?.packages.find((entry) => entry.name === name)?.title ?? name
  }
  const said = (label: string) => entries.filter((entry) => entry.definition.label === label).length

  return entries
    .map((entry) => ({
      key: entry.key,
      costGroup: entry.definition.costGroup,
      label:
        said(entry.definition.label) > 1
          ? `${entry.definition.label} (${packageOf(entry.key)})`
          : entry.definition.label,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))
}
