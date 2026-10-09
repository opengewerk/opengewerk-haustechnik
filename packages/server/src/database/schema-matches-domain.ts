import type {
  Activity,
  ActivityDuty,
  ActivitySignature,
  Building,
  BuildingClosure,
  Contact,
  Defect,
  Duty,
  DutyDismissal,
  Evidence,
  EvidenceVoiding,
  Floor,
  Import,
  KeptDefectClassTerm,
  KeptKindName,
  MeterExchange,
  MeterPause,
  MeterPoint,
  MeterReading,
  MeterSetting,
  PlaceLabel,
  Property,
  Room,
  RoundPlan,
  RoundTemplate,
  RoundTemplateVersion,
  WorkOrder,
  WorkOrderDecision,
  WorkOrderNote,
  WorkOrderParticipant,
} from '@opengewerk/haustechnik-domain'

import type {
  activities,
  activityDuties,
  activitySignatures,
  buildingClosures,
  buildings,
  contacts,
  defectClassTerms,
  defects,
  duties,
  dutyDismissals,
  evidence,
  evidenceVoidings,
  floors,
  assetKindNames,
  imports,
  labels,
  meterExchanges,
  meterPauses,
  meterSettings,
  meterPoints,
  meterReadings,
  properties,
  rooms,
  roundPlans,
  roundTemplates,
  roundTemplateVersions,
  workOrderDecisions,
  workOrderNotes,
  workOrderParticipants,
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
export type ContactMatches = Assert<Exact<typeof contacts.$inferSelect, Contact>>
export type BuildingClosureMatches = Assert<
  Exact<typeof buildingClosures.$inferSelect, BuildingClosure>
>
export type PlaceLabelMatches = Assert<Exact<typeof labels.$inferSelect, PlaceLabel>>
export type ImportMatches = Assert<Exact<typeof imports.$inferSelect, Import>>
export type KeptKindNameMatches = Assert<Exact<typeof assetKindNames.$inferSelect, KeptKindName>>
export type DutyMatches = Assert<Exact<typeof duties.$inferSelect, Duty>>
export type DutyDismissalMatches = Assert<Exact<typeof dutyDismissals.$inferSelect, DutyDismissal>>
export type EvidenceMatches = Assert<Exact<typeof evidence.$inferSelect, Evidence>>
export type EvidenceVoidingMatches = Assert<
  Exact<typeof evidenceVoidings.$inferSelect, EvidenceVoiding>
>
export type ActivityMatches = Assert<Exact<typeof activities.$inferSelect, Activity>>
export type ActivityDutyMatches = Assert<Exact<typeof activityDuties.$inferSelect, ActivityDuty>>
export type DefectMatches = Assert<Exact<typeof defects.$inferSelect, Defect>>
export type DefectClassTermMatches = Assert<
  Exact<typeof defectClassTerms.$inferSelect, KeptDefectClassTerm>
>

/**
 * A work order carries the kind of its activity, always `work_order`, only so
 * that the key to the activity can say it; the model has no use for it.
 */
export type WorkOrderMatches = Assert<
  Exact<Omit<typeof workOrders.$inferSelect, 'activityKind'>, WorkOrder>
>
export type ActivitySignatureMatches = Assert<
  Exact<typeof activitySignatures.$inferSelect, ActivitySignature>
>
export type WorkOrderParticipantMatches = Assert<
  Exact<Omit<typeof workOrderParticipants.$inferSelect, 'activityKind'>, WorkOrderParticipant>
>
export type WorkOrderNoteMatches = Assert<
  Exact<Omit<typeof workOrderNotes.$inferSelect, 'activityKind'>, WorkOrderNote>
>

export type WorkOrderDecisionMatches = Assert<
  Exact<typeof workOrderDecisions.$inferSelect, WorkOrderDecision>
>

export type RoundTemplateMatches = Assert<Exact<typeof roundTemplates.$inferSelect, RoundTemplate>>
export type RoundTemplateVersionMatches = Assert<
  Exact<typeof roundTemplateVersions.$inferSelect, RoundTemplateVersion>
>
export type RoundPlanMatches = Assert<Exact<typeof roundPlans.$inferSelect, RoundPlan>>

export type MeterPointMatches = Assert<Exact<typeof meterPoints.$inferSelect, MeterPoint>>
export type MeterReadingMatches = Assert<Exact<typeof meterReadings.$inferSelect, MeterReading>>
export type MeterExchangeMatches = Assert<Exact<typeof meterExchanges.$inferSelect, MeterExchange>>
export type MeterPauseMatches = Assert<Exact<typeof meterPauses.$inferSelect, MeterPause>>
export type MeterSettingMatches = Assert<Exact<typeof meterSettings.$inferSelect, MeterSetting>>
