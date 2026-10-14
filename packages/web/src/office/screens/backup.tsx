import type { Right } from '@opengewerk/haustechnik-domain'
import {
  BackupBar as FoundationBackupBar,
  BackupScreen as FoundationBackupScreen,
  type BackupWords,
} from '@opengewerk/platform-web/office'

/**
 * The words of "Sicherung", `sicherung()` of the boards of the settings (10):
 * the hour and the place of the archives are set by the area of the instance,
 * and the manual says how.
 */
const words: BackupWords = {
  how: () =>
    'Jeden Tag sichert die Instanz die Datenbank und den Dateispeicher in ein Archiv, und vierzehn Generationen bleiben. Die Uhrzeit legt die Verwaltung der Instanz fest.',
  elsewhere:
    'Eine Sicherung auf derselben Platte wie die Daten übersteht einen Fehler, aber keinen Ausfall der Platte. Die Verwaltung der Instanz legt die Archive deshalb auf eine andere Maschine; das Handbuch beschreibt, wie.',
  unencrypted:
    'Das Archiv liegt unverschlüsselt, und es enthält Namen, Nachweise und Unterschriften. Die Verwaltung der Instanz verschlüsselt es mit einem öffentlichen Schlüssel; das Handbuch beschreibt, wie.',
  fresh: 'Die letzte Sicherung ist keine 24 Stunden alt.',
}

/**
 * "Einstellungen", "Sicherung" (#127): when the instance was last backed up.
 * Read-only, and the screen is the foundation's.
 */
export function BackupScreen() {
  return <FoundationBackupScreen words={words} />
}

/**
 * The line at the top of the office when the backups are behind, the board
 * "Leisten im Büro": only for whoever may see the settings, the Leitung.
 */
export function BackupBar() {
  return <FoundationBackupBar right={'settings.read' satisfies Right} />
}
