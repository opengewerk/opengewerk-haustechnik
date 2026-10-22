import { childrenOf, DerRefusal, type DerElement, oidOf, readElement } from './der.js'

/**
 * The level a certificate states for the signatures made with it (#526,
 * section 2.6 of the concept): "qualified" where it carries the statement of
 * ETSI EN 319 412-5 that it is an EU qualified certificate (QcCompliance in
 * the extension QCStatements), "advanced" otherwise. Only what the
 * certificate says of itself: whether its issuer stands on a trusted list is
 * not checked, and the screen says so beside it.
 */
export type StatedLevel = 'qualified' | 'advanced'

const oids = {
  qcStatements: '1.3.6.1.5.5.7.1.3',
  qcCompliance: '0.4.0.1862.1.1',
} as const

export function statedLevelOf(certificate: Uint8Array): StatedLevel {
  try {
    return statements(certificate).includes(oids.qcCompliance) ? 'qualified' : 'advanced'
  } catch (error) {
    // A certificate that verified its signature but whose extensions do not
    // read states nothing more than an advanced signature.
    if (error instanceof DerRefusal) {
      return 'advanced'
    }

    throw error
  }
}

/** The ids of the statements in the extension QCStatements, none where it has none. */
function statements(certificate: Uint8Array): string[] {
  const [tbs] = childrenOf(readElement(certificate))
  // The extensions are the explicit [3] of the TBSCertificate.
  const tagged = childrenOf(tbs as DerElement).find((child) => child.tag === 0xa3)

  if (tagged === undefined) {
    return []
  }

  const [extensions] = childrenOf(tagged)

  for (const extension of childrenOf(extensions as DerElement)) {
    const parts = childrenOf(extension)
    const id = parts[0]
    const value = parts.at(-1)

    if (id === undefined || value === undefined || value.tag !== 0x04) {
      continue
    }

    if (oidOf(id) === oids.qcStatements) {
      return childrenOf(readElement(value.contents)).map((statement) => {
        const [statementId] = childrenOf(statement)

        return statementId === undefined ? '' : oidOf(statementId)
      })
    }
  }

  return []
}
