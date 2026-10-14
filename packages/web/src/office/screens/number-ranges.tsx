import type { NumberRangeKey, Right } from '@opengewerk/haustechnik-domain'
import {
  NumberRangesScreen as FoundationNumberRangesScreen,
  type NumberRangeWords,
} from '@opengewerk/platform-web/office'

/**
 * The words of "Nummernkreise", `nummernkreise()` of the boards of the
 * settings (2.2, 2.6, 4.8): each sequence with when it draws its number.
 */
const words: NumberRangeWords<NumberRangeKey> = {
  sub: 'Wie Anlagen, Aufträge und Nachweise dieses Betreibers nummeriert werden.',
  explanation: (
    <>
      Im Muster steht {'{year}'} für das Jahr, in dem die Nummer vergeben wird, und {'{number}'} für
      die laufende Nummer; {'{number:5}'} füllt sie mit Nullen auf fünf Stellen auf. Ein neues
      Muster gilt ab der nächsten Nummer, vergebene bleiben, wie sie sind.
    </>
  ),
  ranges: {
    asset: {
      title: 'Anlagen',
      covers:
        'Jede neue Anlage bekommt die nächste Nummer, eine ohne Netz, sobald sie übertragen ist. Vergeben wird keine zweimal.',
    },
    work_order: {
      title: 'Aufträge',
      covers: 'Beim Anlegen, aus einem Mangel, einem Termin oder von Hand.',
    },
    evidence: { title: 'Nachweise', covers: 'Beim Festschreiben, lückenlos.' },
  },
  nextHeading: 'Die nächste heißt',
  saved: (_key, next) => `Gespeichert. Die nächste Nummer heißt ${next}.`,
  note: 'Die nächste Nummer geht nur nach oben, etwa um die Zählung einer Vorgängeranwendung fortzusetzen.',
}

/**
 * "Einstellungen", "Nummernkreise" (#127): how assets, work orders and
 * evidence are numbered. The screen is the foundation's; the Leitung changes
 * a sequence, everybody else who reads the settings sees the same table with
 * nothing to press.
 */
export function NumberRangesScreen() {
  return (
    <FoundationNumberRangesScreen
      rights={{ write: 'settings.write' satisfies Right }}
      words={words}
    />
  )
}
