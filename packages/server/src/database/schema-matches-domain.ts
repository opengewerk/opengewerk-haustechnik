import type {
  Activity,
  ActivityDuty,
  Building,
  Defect,
  Duty,
  DutyDismissal,
  Evidence,
  Floor,
  Property,
  Room,
  WorkOrder,
} from '@opengewerk/haustechnik-domain'

import type {
  activities,
  activityDuties,
  buildings,
  defects,
  duties,
  dutyDismissals,
  evidence,
  floors,
  properties,
  rooms,
  workOrders,
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
export type ActivityMatches = Assert<Exact<typeof activities.$inferSelect, Activity>>
export type ActivityDutyMatches = Assert<Exact<typeof activityDuties.$inferSelect, ActivityDuty>>
export type DefectMatches = Assert<Exact<typeof defects.$inferSelect, Defect>>

/**
 * A work order carries the kind of its activity, always `work_order`, only so
 * that the key to the activity can say it; the model has no use for it.
 */
export type WorkOrderMatches = Assert<
  Exact<Omit<typeof workOrders.$inferSelect, 'activityKind'>, WorkOrder>
>
