import type {
  Building,
  Duty,
  DutyDismissal,
  Evidence,
  Floor,
  Property,
  Room,
} from '@opengewerk/haustechnik-domain'

import type {
  buildings,
  duties,
  dutyDismissals,
  evidence,
  floors,
  properties,
  rooms,
} from './schema/index.js'

/**
 * The model in `domain` is what the data means; the tables are only where it
 * is kept. This file makes the compiler say so: each line demands that a row
 * and its model are the same shape in both directions, so a column added on
 * one side and forgotten on the other does not compile. The same check as in
 * the repository the foundation comes from, for the records of this
 * application.
 */
type Exact<Row, Model> = [Row] extends [Model] ? ([Model] extends [Row] ? true : false) : false

type Assert<Matches extends true> = Matches

export type PropertyMatches = Assert<Exact<typeof properties.$inferSelect, Property>>
export type BuildingMatches = Assert<Exact<typeof buildings.$inferSelect, Building>>
export type FloorMatches = Assert<Exact<typeof floors.$inferSelect, Floor>>
export type RoomMatches = Assert<Exact<typeof rooms.$inferSelect, Room>>
export type DutyMatches = Assert<Exact<typeof duties.$inferSelect, Duty>>
export type DutyDismissalMatches = Assert<Exact<typeof dutyDismissals.$inferSelect, DutyDismissal>>
export type EvidenceMatches = Assert<Exact<typeof evidence.$inferSelect, Evidence>>
