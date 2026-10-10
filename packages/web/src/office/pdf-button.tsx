import { Button } from '@opengewerk/platform-web'
import { NoteBox } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { Printer } from 'lucide-react'
import { useState } from 'react'

import { fetchPdf, openPdf } from '../app/prints.js'

/** What the page says when the PDF did not come. */
export const pdfWords = {
  open: 'PDF öffnen',
  offline: 'Ohne Verbindung zum Server gibt es kein PDF.',
} as const

/**
 * "PDF öffnen" in the head of the page of an evidence or a round (#111): the
 * file is fetched and opened in a tab of its own. What the server says when
 * it makes none, the page shows below its head.
 */
export function usePdf(
  address: string,
  name: string,
): { readonly button: React.ReactNode; readonly trouble: React.ReactNode } {
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  return {
    button: (
      <Button
        icon={Printer}
        disabled={working}
        onClick={() => {
          setWorking(true)
          setTrouble(null)
          fetchPdf(address)
            .then((file) => {
              openPdf(file, name)
            })
            .catch((error: unknown) => {
              setTrouble(error instanceof RequestRefused ? error.message : pdfWords.offline)
            })
            .finally(() => {
              setWorking(false)
            })
        }}
      >
        {pdfWords.open}
      </Button>
    ),
    trouble: trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>,
  }
}
