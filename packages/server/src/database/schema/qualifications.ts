import { qualificationSchema } from '@opengewerk/platform-server'

/**
 * The qualifications of the people who work for the operator (#337, section
 * 4.3 of the concept), made with the factory of the foundation (ADR 0012 in
 * the repository opengewerk): the kinds the operator adds to those of the
 * packages, and what each person holds, until a day or without one, with
 * the certificate as a file of the store. Tenant-wide and without an area;
 * a device holds the qualifications of its own person and no others.
 */
export const { qualificationKinds, qualifications } = qualificationSchema()
