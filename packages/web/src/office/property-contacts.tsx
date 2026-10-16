import { operatorContacts } from '@opengewerk/haustechnik-domain'
import { ContactsPanel, type ContactsPanelWords } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { useSync } from '@opengewerk/platform-web/sync'

import { useHoldsArea } from '../session/areas.js'
import { makeAt } from '../sync/made-at.js'

/**
 * What the card of the foundation says where its words are this application's:
 * what somebody is at a property, with its examples, the word on the button
 * as the board draws it, and the two sentences that name its records.
 */
export const propertyContactWords: ContactsPanelWords = {
  role: {
    label: 'Funktion',
    hint: 'Zum Beispiel Hausmeister, Schulleitung oder Verwaltung.',
  },
  add: 'Hinzufügen',
  needsConnection: 'Ansprechpartner werden mit Verbindung gepflegt. Gerade ist keine da.',
  removal:
    'Danach steht der Ansprechpartner an dieser Liegenschaft nicht mehr, auch nicht auf den Geräten vor Ort.',
}

/** What the card says while nobody is entered. */
export const noPropertyContact = 'An dieser Liegenschaft ist noch kein Ansprechpartner eingetragen.'

/**
 * The people to talk to at a property (section 4.1 of the concept), on its
 * page in the office, as `liegenschaft()` of the boards draws them: the card
 * of the foundation (ADR 0010 of the repository opengewerk), with one line
 * per person in the narrow column.
 *
 * A contact is kept with the property it hangs on, by whoever keeps the
 * properties, and with a connection (ADR 0006, point 6): the device holds the
 * contacts to read them, a new one is made at its route and not through the
 * outbox, and the card says before anybody fills it in when there is no
 * connection. Whoever only reads sees neither the button nor a pencil.
 */
export function PropertyContacts({
  propertyId,
  areaId,
}: {
  readonly propertyId: string
  /** The area of the property: whoever does not hold it reads the contacts only (#309). */
  readonly areaId: unknown
}) {
  const client = useSync()
  const holds = useHoldsArea(areaId)
  const keeps = useRight('location.write') && holds

  return (
    <ContactsPanel
      parent={{ propertyId }}
      rules={operatorContacts}
      words={propertyContactWords}
      creates={keeps}
      corrects={keeps}
      empty={noPropertyContact}
      make={(values) => makeAt(client, '/contacts', values)}
      dense
    />
  )
}
