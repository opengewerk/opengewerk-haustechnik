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

/**
 * Opens a PDF in a tab of its own. A browser that blocks the tab, because
 * the click lies too long back, gets the file to save instead.
 */
export function openPdf(file: Blob, name: string): void {
  const address = URL.createObjectURL(file)

  if (window.open(address, '_blank') !== null) {
    return
  }

  const link = document.createElement('a')

  link.href = address
  link.download = `${name}.pdf`
  link.click()
}
