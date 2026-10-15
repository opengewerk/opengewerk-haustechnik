import type {
  Activity,
  Article,
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
  RoundRecord,
  RoundTemplate,
  RoundTemplateVersion,
  ServiceReport,
  ServiceReportRecord,
  StockMovement,
  StockSupplier,
  Store,
  StoreArticle,
  Task,
  WorkOrder,
  WorkOrderDecision,
  WorkOrderNote,
  WorkOrderParticipant,
  WorkOrderSetting,
} from '@opengewerk/haustechnik-domain'

import type {
  activities,
  articles,
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
  tasks,
  meterExchanges,
  meterPauses,
  meterSettings,
  meterPoints,
  meterReadings,
  properties,
  rooms,
  roundPlans,
  roundRecords,
  serviceReportRecords,
  serviceReports,
  stockMovements,
  storeArticles,
  stores,
  suppliers,
  workOrderSettings,
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
/**
 * A row that can hang on the property itself, and a building, carry the
 * property a second time, only so that the key of the area can say it (ADR
 * 0003, addendum of #306); the model has no use for it.
 */
type Placed<Row> = Omit<Row, 'areaFromPropertyId'>

export type BuildingMatches = Assert<Exact<Placed<typeof buildings.$inferSelect>, Building>>
export type FloorMatches = Assert<Exact<typeof floors.$inferSelect, Floor>>
export type RoomMatches = Assert<Exact<typeof rooms.$inferSelect, Room>>
export type ContactMatches = Assert<Exact<typeof contacts.$inferSelect, Contact>>
export type BuildingClosureMatches = Assert<
  Exact<typeof buildingClosures.$inferSelect, BuildingClosure>
>
export type PlaceLabelMatches = Assert<Exact<Placed<typeof labels.$inferSelect>, PlaceLabel>>
export type ImportMatches = Assert<Exact<typeof imports.$inferSelect, Import>>
export type KeptKindNameMatches = Assert<Exact<typeof assetKindNames.$inferSelect, KeptKindName>>
export type DutyMatches = Assert<Exact<Placed<typeof duties.$inferSelect>, Duty>>
export type DutyDismissalMatches = Assert<Exact<typeof dutyDismissals.$inferSelect, DutyDismissal>>
export type EvidenceMatches = Assert<Exact<typeof evidence.$inferSelect, Evidence>>
export type EvidenceVoidingMatches = Assert<
  Exact<typeof evidenceVoidings.$inferSelect, EvidenceVoiding>
>
export type ActivityMatches = Assert<Exact<Placed<typeof activities.$inferSelect>, Activity>>
export type ActivityDutyMatches = Assert<Exact<typeof activityDuties.$inferSelect, ActivityDuty>>
export type DefectMatches = Assert<Exact<Placed<typeof defects.$inferSelect>, Defect>>
export type TaskMatches = Assert<Exact<Placed<typeof tasks.$inferSelect>, Task>>
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
export type RoundPlanMatches = Assert<Exact<Placed<typeof roundPlans.$inferSelect>, RoundPlan>>
export type RoundRecordMatches = Assert<Exact<typeof roundRecords.$inferSelect, RoundRecord>>

export type MeterPointMatches = Assert<Exact<typeof meterPoints.$inferSelect, MeterPoint>>
export type MeterReadingMatches = Assert<Exact<typeof meterReadings.$inferSelect, MeterReading>>
export type MeterExchangeMatches = Assert<Exact<typeof meterExchanges.$inferSelect, MeterExchange>>
export type MeterPauseMatches = Assert<Exact<typeof meterPauses.$inferSelect, MeterPause>>
export type MeterSettingMatches = Assert<Exact<typeof meterSettings.$inferSelect, MeterSetting>>
export type ServiceReportMatches = Assert<Exact<typeof serviceReports.$inferSelect, ServiceReport>>
export type ServiceReportRecordMatches = Assert<
  Exact<typeof serviceReportRecords.$inferSelect, ServiceReportRecord>
>
export type ArticleMatches = Assert<
  Exact<Omit<typeof articles.$inferSelect, 'unit'>, Omit<Article, 'unit'>>
>
export type SupplierMatches = Assert<Exact<typeof suppliers.$inferSelect, StockSupplier>>
export type StoreMatches = Assert<Exact<typeof stores.$inferSelect, Store>>
export type StoreArticleMatches = Assert<Exact<typeof storeArticles.$inferSelect, StoreArticle>>
export type StockMovementMatches = Assert<
  Exact<Omit<typeof stockMovements.$inferSelect, 'kind'>, Omit<StockMovement, 'kind'>>
>
export type WorkOrderSettingMatches = Assert<
  Exact<typeof workOrderSettings.$inferSelect, WorkOrderSetting>
>
