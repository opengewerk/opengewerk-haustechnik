import {
  byNameIn,
  type InvitationLimits,
  isLimited,
  limitWords,
  type MemberLimits,
  type MemberLimitsOf,
  noLimits,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import { Choice, FieldLabel, SelectField } from '@opengewerk/platform-web'
import { Chip } from '@opengewerk/platform-web/office'
import { maybeText, request, useRecords } from '@opengewerk/platform-web/sync'
import { X } from 'lucide-react'

import { useCatalogue } from '../sync/catalogue.js'
import { assetKindChoices } from './register-filter.js'

/**
 * What an access from outside is limited to beside its areas (#339, the
 * boards of an access and of "Zugänge" with an auditor): the properties and the
 * kinds of assets of an auditor, as a part of the dialogs of "Zugänge". The
 * database holds it; this names it.
 */

export const memberLimitsQuery = {
  queryKey: ['member-limits'],
  queryFn: () => request<MemberLimitsOf[]>('/areas/limits'),
} as const

export const invitationLimitsQuery = {
  queryKey: ['invitation-limits'],
  queryFn: () => request<InvitationLimits[]>('/areas/invitation-limits'),
} as const

/** The limits while a dialog is open: named properties or all of the areas, and the kinds. */
export interface LimitChoice {
  readonly propertiesNamed: boolean
  readonly propertyIds: readonly PropertyId[]
  readonly assetKinds: readonly string[]
}

export const noLimitChoice: LimitChoice = { propertiesNamed: false, ...noLimits }

export function limitChoiceOf(limits: MemberLimits | undefined): LimitChoice {
  return limits === undefined
    ? noLimitChoice
    : { propertiesNamed: limits.propertyIds.length > 0, ...limits }
}

/** What goes out beside the areas: the limits of a role that is limited, and nothing for another. */
export function limitsToSend(
  choice: LimitChoice,
  role: string,
): { readonly limits: MemberLimits } | Record<string, never> {
  if (!isLimited([role])) {
    return {}
  }

  return {
    limits: {
      propertyIds: choice.propertiesNamed ? [...choice.propertyIds] : [],
      assetKinds: [...choice.assetKinds],
    },
  }
}

const propertyScopes = [
  { value: 'all', label: limitWords.everyProperty },
  { value: 'named', label: limitWords.namedProperties },
] as const

export const limitFieldWords = {
  noneTicked: 'Ohne genannte Liegenschaft gilt keine Beschränkung auf Liegenschaften.',
  addKind: 'Anlagenart hinzufügen',
  everyKind: 'Alle Anlagenarten',
  add: 'Hinzufügen',
} as const

/** The fields of the limits, under the areas, for the role Prüfer alone. */
export function LimitFields({
  value,
  areaIds,
  onChange,
}: {
  readonly value: LimitChoice
  /** The areas the access holds in, all where it is null. */
  readonly areaIds: readonly string[] | null
  readonly onChange: (next: LimitChoice) => void
}) {
  const records = useRecords('properties')
  const kinds = assetKindChoices(useCatalogue())
  const properties = records
    .filter((record) => areaIds === null || areaIds.includes(maybeText(record, 'areaId') ?? ''))
    .map((record) => ({
      id: String(record['id']) as PropertyId,
      name: maybeText(record, 'name') ?? '',
    }))
    .sort((left, right) => byNameIn(left.name, right.name))
  const labelOf = (key: string) => kinds.find((kind) => kind.key === key)?.label ?? key

  return (
    <div role="group" aria-label={limitWords.title} className="flex flex-col gap-2.5">
      <FieldLabel>{limitWords.properties}</FieldLabel>
      <div className="[&_legend]:sr-only">
        <Choice
          label={limitWords.properties}
          options={propertyScopes}
          value={value.propertiesNamed ? 'named' : 'all'}
          onChange={(next) => {
            onChange({ ...value, propertiesNamed: next === 'named' })
          }}
        />
      </div>
      {value.propertiesNamed ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {properties.map((property) => (
            <label
              key={property.id}
              className="inline-flex min-h-6 items-center gap-[7px] text-[14px] max-lg:min-h-tap"
            >
              <input
                type="checkbox"
                className="size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
                checked={value.propertyIds.includes(property.id)}
                onChange={(event) => {
                  onChange({
                    ...value,
                    propertyIds: event.target.checked
                      ? [...value.propertyIds, property.id]
                      : value.propertyIds.filter((id) => id !== property.id),
                  })
                }}
              />
              {property.name}
            </label>
          ))}
        </div>
      ) : null}
      {value.propertiesNamed && value.propertyIds.length === 0 ? (
        <p className="text-[12px] leading-[1.4] font-semibold text-waiting">
          {limitFieldWords.noneTicked}
        </p>
      ) : null}
      <div role="group" aria-label={limitWords.assetKinds} className="flex flex-col gap-1.5">
        <FieldLabel>{limitWords.assetKinds}</FieldLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          {value.assetKinds.map((kind) => (
            <Chip
              key={kind}
              pressed
              onPress={() => {
                onChange({ ...value, assetKinds: value.assetKinds.filter((each) => each !== kind) })
              }}
            >
              <span className="inline-flex items-center gap-1">
                {labelOf(kind)}
                <X aria-hidden size={13} />
              </span>
            </Chip>
          ))}
          <div className="w-full sm:w-[240px]">
            <SelectField
              label={limitFieldWords.addKind}
              value=""
              options={[
                {
                  value: '',
                  label:
                    value.assetKinds.length === 0 ? limitFieldWords.everyKind : limitFieldWords.add,
                },
                ...kinds
                  .filter((kind) => !value.assetKinds.includes(kind.key))
                  .map((kind) => ({ value: kind.key, label: kind.label })),
              ]}
              onChange={(next) => {
                if (next !== '') {
                  onChange({ ...value, assetKinds: [...value.assetKinds, next] })
                }
              }}
            />
          </div>
        </div>
        <p className="text-[12px] leading-[1.4] text-ink-muted">{limitWords.everyKind}</p>
      </div>
    </div>
  )
}
