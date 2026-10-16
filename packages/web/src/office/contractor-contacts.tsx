import { operatorContacts } from '@opengewerk/haustechnik-domain'
import { ContactsPanel, type ContactsPanelWords } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { useSync } from '@opengewerk/platform-web/sync'

import { makeAt } from '../sync/made-at.js'

/** What the card says where its words are this application's, for the people of a firm. */
export const contractorContactWords: ContactsPanelWords = {
  role: {
    label: 'Funktion',
    hint: 'Zum Beispiel Disposition, Kundendienst oder Notdienst.',
  },
  add: 'Hinzufügen',
  needsConnection: 'Ansprechpartner werden mit Verbindung gepflegt. Gerade ist keine da.',
  removal:
    'Danach steht der Ansprechpartner an dieser Fremdfirma nicht mehr, auch nicht auf den Geräten vor Ort.',
}

/** What the card says while nobody is entered. */
export const noContractorContact =
  'Bei dieser Fremdfirma ist noch kein Ansprechpartner eingetragen.'

/**
 * The people to talk to at a contractor (#328, section 4.11 of the concept),
 * on the page of the firm, as `fremdfirma()` of the boards draws them: the
 * card of the foundation, as at a property. A firm lies in no area, and
 * neither do its people (ADR 0003, addendum of #328): every device of the
 * operator holds them. They are kept by whoever keeps the firms, with a
 * connection, and a removed firm keeps them only to be read.
 */
export function ContractorContacts({
  contractorId,
  removed,
}: {
  readonly contractorId: string
  readonly removed: boolean
}) {
  const client = useSync()
  const keepsFirms = useRight('contractor.write')
  const keepsPlaces = useRight('location.write')
  const keeps = keepsFirms && keepsPlaces && !removed

  return (
    <ContactsPanel
      parent={{ contractorId }}
      rules={operatorContacts}
      words={contractorContactWords}
      creates={keeps}
      corrects={keeps}
      empty={noContractorContact}
      make={(values) => makeAt(client, '/contacts', values)}
      dense
    />
  )
}
