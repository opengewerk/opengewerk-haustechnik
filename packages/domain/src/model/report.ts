import { fileHashProblem, type IsoDate } from '@opengewerk/platform-domain'

import { classNotOffered, defectProblems } from './defect.js'
import { evidenceProblems, type EvidenceResult, evidenceResults } from './evidence.js'
import type { Problems } from './fields.js'

/**
 * The file a report comes in as: the bytes went up ahead of it, under their
 * hash, and this names them with the name the file had, its size and the
 * small picture of a photo, as a version of a document does.
 */
export interface ReportFile {
  readonly sha256: string
  readonly fileName: string
  readonly sizeBytes: number
  readonly previewSha256: string | null
}

/** A defect the report names, found on the day of the test. */
export interface ReportDefect {
  readonly description: string
  /** A class of a package, `<package>.<key>`, or none. */
  readonly defectClass: string | null
  /** The day by which it is to be set right, or none. */
  readonly dueOn: IsoDate | null
}

/**
 * The report of a contractor or an inspection body (section 4.4 of the
 * concept, "fremde Durchführung"), as the office enters it: the file, the
 * examiner and the organisation, the day of the test, its result and the
 * defects it names. It becomes the evidence of one duty. A report that covers
 * many assets at once is the collective evidence of phase 2.
 */
export interface Report {
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  /** Why it was not performed; only a result "not performed" has one. */
  readonly resultReason: string | null
  readonly examiner: string
  readonly examinerOrganisation: string
  readonly file: ReportFile
  readonly defects: readonly ReportDefect[]
}

/**
 * Whether a duty takes a report as its evidence: one of the operator's own
 * takes every way, one from the catalogue the ways its kind names. A kind the
 * catalogue at hand does not know takes none, so that nothing is offered the
 * server would refuse.
 */
export function takesAReport(
  duty: { readonly kind: string | null },
  kind: {
    readonly definition: { readonly evidence: { readonly kinds: readonly string[] } }
  } | null,
): boolean {
  return duty.kind === null || (kind?.definition.evidence.kinds.includes('report') ?? false)
}

/** The bounds of a report beside those of every evidence. */
export const reportLimits = {
  fileName: 255,
  defects: 50,
} as const

/** The results that name defects: a test that found some, passed or not. */
export const resultsWithDefects: readonly EvidenceResult[] = ['with_defects', 'failed']

/** Where the problem of a field of a defect stands among the problems of a report. */
export function reportDefectField(index: number, field: keyof ReportDefect): string {
  return `defects.${String(index)}.${field}`
}

function fileProblem(file: unknown): string | undefined {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    return 'Der Bericht oder die Prüfbescheinigung fehlt.'
  }

  const { sha256, fileName, sizeBytes, previewSha256 } = file as Readonly<Record<string, unknown>>

  if (fileHashProblem(sha256) !== null) {
    return 'Der Bericht oder die Prüfbescheinigung fehlt.'
  }

  if (typeof fileName !== 'string' || fileName.trim() === '') {
    return 'Die Datei hat keinen Namen.'
  }

  if (fileName.trim().length > reportLimits.fileName) {
    return `Der Name der Datei hat höchstens ${String(reportLimits.fileName)} Zeichen.`
  }

  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return 'Die Größe der Datei fehlt.'
  }

  if (previewSha256 !== undefined && previewSha256 !== null && fileHashProblem(previewSha256)) {
    return 'Die Vorschau der Datei ist keine Datei.'
  }

  return undefined
}

/**
 * What is wrong with a report as somebody enters it, on this day: the file is
 * there, the day lies in the past, the result is given with its reason, and
 * a report always names the examiner and the organisation (section 4.4).
 * A result with defects names at least one, one without defects and one not
 * performed name none, and a failed test may. Each defect is a defect found
 * on the day of the test, and its class is one the duty offers
 * (`defectClassChoices`).
 */
export function reportProblems(
  report: Readonly<Record<string, unknown>>,
  today: IsoDate,
  offersClass: (key: string) => boolean,
): Readonly<Problems> {
  const problems: Problems = { ...evidenceProblems(report) }
  const file = fileProblem(report['file'])

  if (file !== undefined) {
    problems['file'] = file
  }

  const performedOn = report['performedOn']

  if (performedOn === undefined || performedOn === null || performedOn === '') {
    problems['performedOn'] = 'Der Tag der Durchführung fehlt.'
  } else if (problems['performedOn'] === undefined && (performedOn as string) > today) {
    problems['performedOn'] = 'Ein Nachweis gilt für einen Tag, der schon war.'
  }

  const result = report['result']

  if (!evidenceResults.includes(result as EvidenceResult)) {
    problems['result'] ??= 'Das Ergebnis fehlt.'
  }

  const named = (field: string) => {
    const value = report[field]

    return typeof value === 'string' && value.trim() !== ''
  }

  // Said for a report in its own words, in place of the sentence that the
  // two go together, which is for an evidence that may name neither.
  if (!named('examiner')) {
    problems['examiner'] = 'Ein Bericht nennt den Prüfer.'
  }

  if (!named('examinerOrganisation')) {
    problems['examinerOrganisation'] = 'Ein Bericht nennt die Organisation des Prüfers.'
  }

  const defects = report['defects'] ?? []

  if (!Array.isArray(defects)) {
    problems['defects'] = 'Die Mängel sind eine Liste.'

    return problems
  }

  if (defects.length > reportLimits.defects) {
    problems['defects'] =
      `Ein Bericht nennt höchstens ${String(reportLimits.defects)} Mängel; mehr kommen mit den Sammelnachweisen.`
  } else if (result === 'with_defects' && defects.length === 0) {
    problems['defects'] = 'Mit Mängeln heißt, der Bericht nennt mindestens einen Mangel.'
  } else if (
    defects.length > 0 &&
    evidenceResults.includes(result as EvidenceResult) &&
    !resultsWithDefects.includes(result as EvidenceResult)
  ) {
    problems['defects'] =
      result === 'not_performed'
        ? 'Was nicht durchgeführt wurde, nennt keinen Mangel.'
        : 'Ohne Mangel heißt, der Bericht nennt keinen Mangel.'
  }

  defects.forEach((defect: unknown, index) => {
    const each =
      typeof defect === 'object' && defect !== null && !Array.isArray(defect)
        ? (defect as Readonly<Record<string, unknown>>)
        : {}
    const found = defectProblems({
      description: each['description'] ?? '',
      defectClass: each['defectClass'] ?? null,
      dueOn: each['dueOn'] ?? null,
      ...(typeof performedOn === 'string' ? { foundOn: performedOn } : {}),
    })

    for (const field of ['description', 'defectClass', 'dueOn'] as const) {
      const problem = found[field]

      if (problem !== undefined) {
        problems[reportDefectField(index, field)] = problem
      }
    }

    const defectClass = each['defectClass']

    if (
      typeof defectClass === 'string' &&
      defectClass !== '' &&
      found['defectClass'] === undefined &&
      !offersClass(defectClass)
    ) {
      problems[reportDefectField(index, 'defectClass')] = classNotOffered
    }
  })

  return problems
}
