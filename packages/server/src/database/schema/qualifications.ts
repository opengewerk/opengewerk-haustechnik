import { applicationRole, qualificationSchema } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'

/**
 * The qualifications of the people who work for the operator (#337, section
 * 4.3 of the concept), made with the factory of the foundation (ADR 0012 in
 * the repository opengewerk): the kinds the operator adds to those of the
 * packages, and what each person holds, until a day or without one, with
 * the certificate as a file of the store. Tenant-wide and without an area;
 * a device holds the qualifications of its own person and no others.
 */
export const { qualificationKinds, qualifications } = qualificationSchema()

/**
 * Whose qualifications a person sees (section 7 of the concept: a right
 * holds in the areas of the person): their own, those of whoever works in an
 * area they see, and all of them for whoever sees every area and for the
 * runs. A qualification has no area of its own, so the areas of the person
 * it is of decide (`person_in_sight`); the database holds it for reading and
 * writing alike.
 */
export const qualificationsOfPeopleInSight = pgPolicy('of_people_in_sight', {
  as: 'restrictive',
  for: 'all',
  to: applicationRole,
  using: sql`public.person_in_sight(${qualifications.userId})`,
  withCheck: sql`public.person_in_sight(${qualifications.userId})`,
}).link(qualifications)
