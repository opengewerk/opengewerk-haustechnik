import { randomBytes, randomUUID } from 'node:crypto'

import {
  type ActivityId,
  briefingPageOf,
  type Catalogue,
  hotWorkPermitForm,
  type Identity,
  labelCodeFrom,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { freezeServiceReport, serviceReportFingerprint } from '../activities/service-reports.js'
import { pageFingerprint, pageOf, takeSignature } from '../activities/signing.js'
import {
  activities,
  briefings,
  contractors,
  labels,
  properties,
  serviceReports,
  workPermits,
} from '../database/schema/index.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { dayInGermany } from '../today.js'
import { previewColleagues } from './preview-database.js'
import type { BehindTheRoutes } from './sample-data.js'

/** A signature as a finger draws it on a telephone, in the units of `signatureBox`. */
const sampleSignature =
  'M80,260L170,150L240,290L330,120L420,280L510,140L600,260L700,180L820,230L920,200'

/** The people of a firm briefed at a sample order (#330), and in what. */
const sampleBriefed = ['Marco Petri', 'Jonas Weber']
const sampleSubject =
  'Fluchtwege und Sammelplatz, Brandmeldeanlage im Heizraum, Absperrung der Gasleitung, Ansprechpartner vor Ort'

/** What the sample permit for hot work says, by the keys of its form (#330). */
const samplePermit = {
  place: 'Schulhaus, Untergeschoss, Heizraum, Rücklauf Heizkreis Turnhalle',
  method: 'soldering',
  description: 'Undichte Lötstelle am Rücklauf ausbauen und neu hartlöten.',
  period: 'Heute, 08:00 bis 16:00',
  combustibles: 'done',
  openings: 'not_needed',
  extinguishers: 'done',
  detectors: 'done',
  residues: 'done',
  during: 'Jonas Weber',
  after: 'Tobias Wendt, zwei Stunden nach dem Ende',
}

/** The clients who sign the service reports of the sample orders, one after the other. */
const sampleClients = ['Petra Lang', 'Jonas Albrecht', 'Miriam Okafor']

/**
 * What the sample operator has that no route writes: the signatures under
 * the work orders, which a device sends with the day the work was done
 * (#117), the client's signature under the service report of each, which a
 * device sends before it (#324), and the labels of a sheet. The defects are reported through their
 * route since #116, the evidence of the duties through the route of a report
 * since #110, and a work order follows its signature through its routes
 * (`decideSampleOrders`).
 */
export async function writeSampleStandings(
  database: Database,
  planter: Identity,
  planted: BehindTheRoutes,
  catalogue: Catalogue,
): Promise<void> {
  const at = new Date()

  await database.forTenant(planter, async (tx) => {
    // Signed by the person who leads the order, on the day of the planting.
    for (const [index, order] of planted.orders.entries()) {
      const id = order.activityId as ActivityId

      await tx
        .update(activities)
        .set({ status: 'started', performedOn: dayInGermany(at) })
        .where(eq(activities.id, id))

      const [row] = await tx.select().from(activities).where(eq(activities.id, id))

      if (row === undefined) {
        throw new Error(`Den Auftrag ${order.activityId} der Beispieldaten gibt es nicht.`)
      }

      const context = {
        tenantId: planter.tenantId,
        writtenBy: order.leads,
        at,
        catalogue,
        nameOf: (userId: string) =>
          previewColleagues.find((colleague) => colleague.id === userId)?.name ??
          'Unbekanntes Konto',
      }
      // The client signs the service report first, on the device of the
      // person who leads the order, and the server freezes it.
      const clientName = sampleClients[index % sampleClients.length] ?? 'Petra Lang'
      const [report] = await tx
        .insert(serviceReports)
        .values({
          tenantId: planter.tenantId,
          propertyId: row.propertyId,
          areaId: row.areaId,
          activityId: id,
          clientName,
          path: sampleSignature,
          signedBy: order.leads,
          signedAt: at,
          deviceInfo: 'Telefon',
          pageFingerprint: await serviceReportFingerprint(tx, id, planter.tenantId, clientName),
        })
        .returning({ id: serviceReports.id })

      if (report !== undefined) {
        await freezeServiceReport(tx, context, report.id)
      }

      await takeSignature(tx, context, {
        activityId: id,
        role: 'signer',
        signedAt: at,
        deviceInfo: 'Telefon',
        path: sampleSignature,
        typedName: null,
        pageFingerprint: pageFingerprint(await pageOf(tx, row, catalogue)),
      })
    }

    // A firm of the list at work (#330): two of its people briefed on the
    // device of whoever leads the order, and the permit for the hot work in
    // the version of its form in force today, signed by one of them.
    const permitForm = catalogue.form(hotWorkPermitForm, dayInGermany(at))

    for (const visit of planted.visits) {
      const [row] = await tx
        .select()
        .from(activities)
        .where(eq(activities.id, visit.activityId as ActivityId))

      if (row === undefined || row.contractorId === null) {
        throw new Error(`Den Auftrag ${visit.activityId} einer Fremdfirma gibt es nicht.`)
      }

      // The page each person saw and signed, as the server works it out (#545).
      const page = await pageOf(tx, row, catalogue)
      const [firm] = await tx
        .select({ name: contractors.name })
        .from(contractors)
        .where(eq(contractors.id, row.contractorId))

      for (const [index, personName] of sampleBriefed.entries()) {
        await tx.insert(briefings).values({
          tenantId: planter.tenantId,
          propertyId: row.propertyId,
          areaId: row.areaId,
          activityId: row.id,
          contractorId: row.contractorId,
          personName,
          subject: sampleSubject,
          path: sampleSignature,
          signedBy: visit.leads,
          signedAt: new Date(at.getTime() - (30 - index * 4) * 60_000),
          deviceInfo: 'Telefon',
          pageFingerprint: stateFingerprint(
            briefingPageOf(page, firm?.name ?? '', personName, sampleSubject),
          ),
        })
      }

      if (permitForm !== null) {
        await tx.insert(workPermits).values({
          tenantId: planter.tenantId,
          propertyId: row.propertyId,
          areaId: row.areaId,
          activityId: row.id,
          contractorId: row.contractorId,
          formKey: permitForm.key,
          formVersion: permitForm.version,
          answers: {
            ...samplePermit,
            contractor_signature: {
              name: sampleBriefed[0] ?? 'Marco Petri',
              path: sampleSignature,
              signedAt: at.toISOString(),
            },
          },
          signedBy: visit.leads,
          signedAt: new Date(at.getTime() - 15 * 60_000),
          deviceInfo: 'Telefon',
        })
      }
    }

    // The labels of a sheet: on their property and on nothing else, each with
    // a code of its own and the id of their print, as the route that prints a
    // sheet makes them (#170).
    for (const sheet of planted.sheets) {
      const [property] = await tx
        .select({ areaId: properties.areaId })
        .from(properties)
        .where(eq(properties.id, sheet.propertyId as PropertyId))

      if (property === undefined) {
        throw new Error(`Die Liegenschaft ${sheet.propertyId} der Beispieldaten gibt es nicht.`)
      }

      const print = randomUUID()

      await tx.insert(labels).values(
        Array.from({ length: sheet.labels }, () => ({
          tenantId: planter.tenantId,
          propertyId: sheet.propertyId as PropertyId,
          areaId: property.areaId,
          code: labelCodeFrom(randomBytes(10)),
          printId: print,
        })),
      )
    }
  })
}
