import type { BuildingId, TenantId } from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

// What moving a building to another property asks first, and what it says
// when the database refuses it (#307, section 4.1 of the concept, ADR 0002,
// addendum of 15.10.2026). The move itself is one statement: the keys onto
// what a row hangs on follow the building, and a key that names something a
// row does not hang on fails where it crosses the building.

/** The records that are written once and name their place, by the words for one and for several. */
const keptWords = {
  evidence: ['ein Nachweis', 'Nachweise'],
  signatures: ['eine Unterschrift', 'Unterschriften'],
  answers: ['eine Antwort eines Rundgangs', 'Antworten von Rundgängen'],
  decisions: [
    'eine Abnahme oder Zurückweisung eines Auftrags',
    'Abnahmen oder Zurückweisungen von Aufträgen',
  ],
} as const

/**
 * What is written once and hangs on something in the building, counted, as
 * a sentence says it: "14 Nachweise", "eine Unterschrift". Evidence, the
 * signatures and answers of an activity and the decision on a work order name
 * their place and are never changed, so a building with one of them stays
 * where it is. A print, the record of a round and a voiding come only with
 * one of these.
 */
export async function keptAsWritten(
  tx: TenantTransaction,
  tenantId: TenantId,
  buildingId: BuildingId,
): Promise<string[]> {
  const { rows } = await tx.execute<Record<keyof typeof keptWords, number>>(sql`
    with rooms_in as (
           select id from rooms where tenant_id = ${tenantId} and building_id = ${buildingId}),
         assets_in as (
           select id from assets where tenant_id = ${tenantId} and building_id = ${buildingId}),
         activities_in as (
           select id from activities
            where tenant_id = ${tenantId}
              and (building_id = ${buildingId} or room_id in (select id from rooms_in)
                   or asset_id in (select id from assets_in))),
         duties_in as (
           select id from duties
            where tenant_id = ${tenantId}
              and (building_id = ${buildingId} or room_id in (select id from rooms_in)
                   or asset_id in (select id from assets_in)))
    select (select count(*)::int from evidence
             where tenant_id = ${tenantId}
               and (duty_id in (select id from duties_in)
                    or activity_id in (select id from activities_in))) as evidence,
           (select count(*)::int from activity_signatures
             where tenant_id = ${tenantId} and activity_id in (select id from activities_in)) as signatures,
           (select count(*)::int from activity_answers
             where tenant_id = ${tenantId} and activity_id in (select id from activities_in)) as answers,
           (select count(*)::int from work_order_decisions
             where tenant_id = ${tenantId}
               and work_order_id in (select id from work_orders
                                      where tenant_id = ${tenantId}
                                        and activity_id in (select id from activities_in))) as decisions
  `)
  const counted = rows[0]

  return (Object.keys(keptWords) as (keyof typeof keptWords)[]).flatMap((kind) => {
    const many = counted?.[kind] ?? 0
    const [one, several] = keptWords[kind]

    return many === 0 ? [] : [many === 1 ? one : `${String(many)} ${several}`]
  })
}

/** The sentence a building is kept where it is with, for what `keptAsWritten` found. */
export function keptSentence(kept: readonly string[]): string {
  const listed =
    kept.length < 2 ? kept.join('') : `${kept.slice(0, -1).join(', ')} und ${kept.at(-1) ?? ''}`

  return kept.length === 1 && !/^\d/.test(listed)
    ? `An diesem Gebäude hängt ${listed}. Das ist festgeschrieben und nennt seinen Ort; das Gebäude bleibt deshalb, wo es ist.`
    : `An diesem Gebäude hängen ${listed}. Sie sind festgeschrieben und nennen ihren Ort; das Gebäude bleibt deshalb, wo es ist.`
}

/**
 * The keys over a property that name something a row does not hang on, each
 * with what it holds together, for the sentence a move that crosses the
 * building is refused with. Every key over `property_id` onto another table
 * than the properties either follows what a row hangs on or stands here; the
 * catalogue test holds that.
 */
export const holdingTheBuilding: Readonly<Record<string, string>> = {
  activities_of_a_plan_of_their_property: 'ein Rundgang mit dem Plan, nach dem er stattfand',
  // A part at an asset of the building with its collective activity on the property (#342).
  activities_part_of_a_collective: 'eine Prüfung mit dem Sammelvorgang, zu dem sie gehört',
  activity_answers_photo_at_their_activity: 'eine Antwort mit ihrem Foto',
  activity_duties_of_a_duty_of_their_property: 'ein Vorgang mit einer Pflicht, die er erfüllt',
  asset_supplies_to_a_building_of_its_property: 'eine Anlage mit einem Gebäude, das sie versorgt',
  asset_supplies_to_a_room_of_its_property: 'eine Anlage mit einem Raum, den sie versorgt',
  assets_replace_one_of_their_property: 'eine Anlage mit der, die sie ersetzt hat',
  deadlines_with_a_task_of_their_property: 'eine Frist mit ihrer Aufgabe',
  defects_found_in_an_activity_of_their_property:
    'ein Mangel mit dem Vorgang, in dem er festgestellt wurde',
  defects_from_an_answer_of_their_activity: 'ein Mangel mit der Antwort, aus der er kommt',
  defects_named_in_an_evidence_of_their_property: 'ein Mangel mit dem Nachweis, der ihn nennt',
  defects_set_right_by_a_work_order_of_their_property: 'ein Mangel mit dem Auftrag, der ihn behebt',
  duties_interval_document_of_their_property:
    'eine Pflicht mit dem Dokument, das ihren Abstand begründet',
  evidence_from_an_activity_of_its_property: 'ein Nachweis mit dem Vorgang, aus dem er kommt',
  fault_reports_accepted_as_a_work_order_of_their_property:
    'eine Störmeldung mit dem Auftrag, als der sie angenommen wurde',
  fault_reports_merged_in_their_building:
    'eine Störmeldung mit der, mit der sie zusammengeführt ist',
  fault_reports_reported_as_a_defect_of_their_property:
    'eine Störmeldung mit dem Mangel, der aus ihr gemeldet wurde',
  evidence_replaces_one_of_its_duty: 'ein Nachweis mit dem, den er berichtigt',
  meter_points_under_a_meter_of_their_property: 'ein Zähler mit seinem Hauptzähler',
  meter_readings_correct_a_reading_here: 'ein Zählerstand mit dem, den er berichtigt',
  meter_readings_of_an_activity_of_their_property:
    'ein Zählerstand mit dem Rundgang, in dem er abgelesen wurde',
  work_orders_from_a_defect_of_their_property: 'ein Auftrag mit dem Mangel, aus dem er kommt',
}

/** The sentence for a move the database refused where it crossed the building, or nothing for another refusal. */
export function crossingRefusal(error: unknown): string | null {
  for (const candidate of [error, (error as { cause?: unknown } | undefined)?.cause]) {
    const found = candidate as { code?: unknown; constraint?: unknown } | undefined

    if (found?.code !== '23503') {
      continue
    }

    const what =
      typeof found.constraint === 'string' ? holdingTheBuilding[found.constraint] : undefined

    return what === undefined
      ? 'Etwas in diesem Gebäude hängt mit etwas außerhalb zusammen; das Gebäude bleibt deshalb, wo es ist.'
      : `Etwas in diesem Gebäude hängt mit etwas außerhalb zusammen: ${what}. Das Gebäude bleibt deshalb, wo es ist.`
  }

  return null
}
