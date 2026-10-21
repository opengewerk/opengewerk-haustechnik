import { RequestRefused, workingInHeaders } from '@opengewerk/platform-web/sync'

/**
 * The PDF of an evidence and of a round (#111, section 2.6 of the concept),
 * made by the server from the frozen state the first time it is asked for
 * and handed out as the same file every time after. Fetched as a file and
 * not followed as a link: where the instance has no service that makes
 * PDFs, the server answers with a sentence, and the page shows it instead of
 * a tab with the raw answer.
 */

/** The address of the PDF of an evidence. */
export function evidencePdfAddress(evidenceId: string): string {
  return `/evidence/${encodeURIComponent(evidenceId)}/pdf`
}

/** The address of the PDF of a round written down. */
export function roundPdfAddress(roundId: string): string {
  return `/rounds/${encodeURIComponent(roundId)}/pdf`
}

/** The PDF at one of the addresses above, or the sentence the server refused it with. */
export async function fetchPdf(address: string): Promise<Blob> {
  const response = await fetch(address, {
    credentials: 'include',
    // An evidence names people and places of an operator: past the HTTP cache
    // of the browser, as every request of the foundation (#360).
    cache: 'no-store',
    headers: { Accept: 'application/pdf, application/json', ...workingInHeaders() },
  })

  if (!response.ok) {
    const answer = (await response.json().catch(() => null)) as { message?: unknown } | null
    const message =
      typeof answer?.message === 'string' ? answer.message : 'Das PDF ist nicht gelungen.'

    throw new RequestRefused(response.status, message, answer)
  }

  return response.blob()
}

/** The ending of a file of each kind the server hands out here, for the name it is saved under. */
const endings: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Hands a PDF to the browser to save, under the name given and the ending of
 * its kind (#509). Until then it opened in a tab of its own, and where that
 * tab showed no bar of a PDF viewer, as in the installed application, it
 * could be looked at but not kept. A certificate a person brought may be a
 * picture (#337), and is saved as one.
 */
export function savePdf(file: Blob, name: string): void {
  const kind = file.type.split(';')[0]?.trim() ?? ''
  const address = URL.createObjectURL(file)
  const link = document.createElement('a')

  link.href = address
  link.download = `${name}.${endings[kind] ?? 'pdf'}`
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(address)
  }, 0)
}
