/**
 * The log of the reads of an auditor from outside, as the Leitung sees it
 * under "Zugänge" (#339, section 4.3 of the concept: "jeder Zugriff
 * festgehalten"): when, who, and what the request was for, in words.
 */
export interface AuditorRead {
  readonly id: string
  readonly readAt: string
  readonly userId: string
  readonly personName: string
  /** What was read, in words: "Nachweisverzeichnis als PDF". */
  readonly what: string
  /**
   * Of which duty or evidence, where the request named one: "Prüfung der
   * Sicherheitsbeleuchtung, AN-00044", for an evidence its number before it;
   * for a register the property it was asked for, and whether the evidence
   * followed it.
   */
  readonly subject: string | null
}

export interface AuditorReadList {
  readonly reads: readonly AuditorRead[]
  /** Whether older ones follow, asked with `before`. */
  readonly more: boolean
}

/** How many lines one page of the log holds. */
export const auditorReadPage = 50

/** The routes an auditor reaches, in words; another route is named as it is declared. */
const routeWords: Readonly<Record<string, string>> = {
  '/overview': 'Übersicht',
  '/overview/places': 'Übersicht der Orte',
  '/overview/timeline': 'Übersicht, Zeitachse',
  '/duties': 'Pflichtenverzeichnis',
  '/duties/register': 'Pflichtenverzeichnis',
  '/duties/register/table': 'Pflichtenverzeichnis als Tabelle',
  '/duties/proposals': 'Vorschläge des Katalogs',
  '/duties/proposals/table': 'Vorschläge des Katalogs als Tabelle',
  '/duties/updates': 'Neue Fassungen des Katalogs',
  '/duties/evidence-register': 'Nachweisverzeichnis',
  '/duties/evidence-register/pdf': 'Nachweisverzeichnis als PDF',
  '/duties/evidence-register/table': 'Nachweisverzeichnis als Tabelle',
  '/duties/:id': 'Pflicht',
  '/duties/:id/evidence': 'Nachweise einer Pflicht',
  '/duty-dismissals': 'Verworfene Vorschläge',
  '/evidence/:id': 'Nachweis',
  '/evidence/:id/files/:position': 'Datei eines Nachweises',
  '/evidence/:id/pdf': 'Nachweis als PDF',
  '/assets/:id/evidence': 'Nachweise einer Anlage',
  '/assets/:id/duties': 'Pflichten einer Anlage',
  '/rooms/:id/duties': 'Pflichten eines Raums',
  '/catalogue': 'Katalog',
}

/** What a route of the log was for, in words. */
export function auditorReadWhat(route: string): string {
  return routeWords[route] ?? route
}

/** Whether a route names a duty by its `:id`, or an evidence. */
/** What a register says it was asked for with `attach=1`: the evidence followed it. */
export const auditorReadAttached = 'mit Nachweisen und Prüfbescheinigungen'

export function auditorReadNames(route: string): 'duty' | 'evidence' | null {
  if (route.startsWith('/duties/:id')) {
    return 'duty'
  }

  return route.startsWith('/evidence/:id') ? 'evidence' : null
}
