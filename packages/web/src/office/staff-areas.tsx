import {
  type Area,
  type InvitationAreas,
  type MemberAreas,
  seesEveryArea,
} from '@opengewerk/haustechnik-domain'
import { Choice } from '@opengewerk/platform-web'
import type { StaffAdditions, StaffAdditionsPart } from '@opengewerk/platform-web/office'
import { request } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { areasQuery } from '../session/areas.js'

/**
 * The areas somebody holds in, as "Zugänge" shows and changes them (section
 * 2.8 of the concept, the boards `zugaenge`, `zugang_bearbeiten` and
 * `zugang_anlegen`): a column in both tables and a part of both dialogs.
 *
 * The screen and its dialogs are the foundation's (ADR 0010 in the repository
 * opengewerk). What it cannot know is that this application keeps areas
 * beside a membership; this is where it is told, in the shape it asks for
 * (`StaffAdditions`). What goes out travels with the role in one request, so
 * a role and areas that do not fit are refused together (ADR 0003).
 */

/** What a dialog holds of the areas while somebody works in it. */
export interface AreaChoice {
  readonly all: boolean
  readonly areaIds: readonly string[]
}

export const areaWords = {
  title: 'Bereiche',
  all: 'alle',
  none: 'ohne Bereich',
  which: 'Alle oder genannte Bereiche',
  every: 'Alle Bereiche',
  named: 'Genannte Bereiche',
  rule: 'Ein Recht gilt in den Bereichen der Person. Leitung und Technische Leitung haben immer alle.',
  noneTicked: 'Ohne Bereich sieht die Person nichts mit Ortsbezug.',
  withoutAny:
    'Wer ohne Bereich ist, sieht nichts mit Ortsbezug: keine Liegenschaft, keine Anlage, keinen ' +
    'Vorgang. Einen Bereich gibt „Bearbeiten“.',
} as const

/** The areas of everybody who works for the tenant, for whoever decides about them. */
export const memberAreasQuery = {
  queryKey: ['member-areas'],
  queryFn: () => request<MemberAreas[]>('/areas/members'),
} as const

/** What the open invitations say about areas. One that says nothing is not among them. */
export const invitationAreasQuery = {
  queryKey: ['invitation-areas'],
  queryFn: () => request<InvitationAreas[]>('/areas/invitations'),
} as const

/**
 * What a membership begins with where nobody names areas, as the database
 * gives it (ADR 0003, point 2): every area for whoever leads the tenant or
 * answers for its duties; for everybody else the one area of a tenant that
 * has a single one, and none where there are more.
 */
export function areasToBeginWith(roles: readonly string[], areas: readonly Area[]): AreaChoice {
  if (seesEveryArea(roles)) {
    return { all: true, areaIds: [] }
  }

  const [only, ...more] = areas

  return { all: false, areaIds: only !== undefined && more.length === 0 ? [only.id] : [] }
}

/** The areas somebody holds in as a cell says them: "alle", their names, or that there is none. */
export function areasInWords(choice: AreaChoice, areas: readonly Area[]): ReactNode {
  if (choice.all) {
    return areaWords.all
  }

  const names = areas.filter((area) => choice.areaIds.includes(area.id)).map((area) => area.name)

  return names.length === 0 ? (
    <span className="font-semibold text-waiting">{areaWords.none}</span>
  ) : (
    names.join(', ')
  )
}

const scopes = [
  { value: 'all', label: areaWords.every },
  { value: 'named', label: areaWords.named },
] as const

/**
 * All areas or named ones, with the areas of the tenant to tick. A role that
 * holds in every area leaves nothing to choose, and the choice says so by
 * standing still.
 */
function AreaFields({
  areas,
  value,
  role,
  onChange,
}: StaffAdditionsPart<AreaChoice> & { readonly areas: readonly Area[] }) {
  const every = role !== null && seesEveryArea([role])
  const all = every || value.all

  return (
    <>
      {/* The part of the dialog is headed "Bereiche" already; the choice keeps its name for a reader. */}
      <div className="[&_legend]:sr-only">
        <Choice
          label={areaWords.which}
          options={scopes}
          value={all ? 'all' : 'named'}
          disabled={every}
          onChange={(next) => {
            onChange({ ...value, all: next === 'all' })
          }}
        />
      </div>
      {all ? null : (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {areas.map((area) => (
            <label
              key={area.id}
              className="inline-flex min-h-6 items-center gap-[7px] text-[14px] max-lg:min-h-tap"
            >
              <input
                type="checkbox"
                className="size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
                checked={value.areaIds.includes(area.id)}
                onChange={(event) => {
                  onChange({
                    all: false,
                    areaIds: event.target.checked
                      ? [...value.areaIds, area.id]
                      : value.areaIds.filter((id) => id !== area.id),
                  })
                }}
              />
              {area.name}
            </label>
          ))}
        </div>
      )}
      {!all && value.areaIds.length === 0 ? (
        <p className="text-[12px] leading-[1.4] font-semibold text-waiting">
          {areaWords.noneTicked}
        </p>
      ) : null}
      <p className="text-[12px] leading-[1.4] text-ink-muted">{areaWords.rule}</p>
    </>
  )
}

const noAreas: readonly Area[] = []

/**
 * The areas as "Zugänge" of the foundation takes them: asked of the server,
 * said in a column, picked in a dialog, and sent as `{ all, areaIds }`, the
 * shape `PUT /areas/members/:userId` takes as well.
 */
export function useAreaAdditions(): StaffAdditions<AreaChoice> {
  const queries = useQueryClient()
  const areas = useQuery(areasQuery)
  const members = useQuery(memberAreasQuery)
  const invitations = useQuery(invitationAreasQuery)
  const named = areas.data ?? noAreas
  const someoneWithout = (members.data ?? []).some(
    (entry) => !entry.all && entry.areaIds.length === 0,
  )

  return {
    title: areaWords.title,
    // As narrow as the boards draw it, so that the buttons of a row stay on
    // one line; wider where "ohne Bereich" has to fit.
    column: someoneWithout ? 'w-[96px]' : 'w-[64px]',
    known: areas.data !== undefined && members.data !== undefined && invitations.data !== undefined,
    // What the database holds, not what the role would suggest: the line
    // between the areas is drawn from these rows.
    ofMember: (person) => {
      const held = members.data?.find((entry) => entry.userId === person.userId)

      return held ? areasInWords(held, named) : null
    },
    // An invitation that says nothing begins with what a new membership is given.
    ofInvitation: (invitation) =>
      areasInWords(
        invitations.data?.find((entry) => entry.invitationId === invitation.id) ??
          areasToBeginWith(invitation.roles, named),
        named,
      ),
    note: someoneWithout ? areaWords.withoutAny : null,
    startWith: (person) => {
      const held =
        person === null ? undefined : members.data?.find((entry) => entry.userId === person.userId)

      return held ? { all: held.all, areaIds: held.areaIds } : areasToBeginWith([], named)
    },
    fields: (part) => <AreaFields areas={named} {...part} />,
    toSend: (value, role) => {
      const all = seesEveryArea([role]) || value.all

      return { all, areaIds: all ? [] : [...value.areaIds] }
    },
    refresh: () => {
      void queries.invalidateQueries({ queryKey: memberAreasQuery.queryKey })
      void queries.invalidateQueries({ queryKey: invitationAreasQuery.queryKey })
    },
  }
}
