# Maßnahmen und Signatur der Instanz

Was die Verwaltung für jeden Betreiber in die Maßnahmen einträgt, und wie die Instanz ihre PDFs signiert, mit Zertifikat, Fingerabdruck und neuem Schlüssel.

## Maßnahmen

Jeder Betreiber erzeugt unter „Datenschutz“ seine technischen und organisatorischen Maßnahmen, als Anlage zum Vertrag zur Auftragsverarbeitung. Teil A sagt, was die Anwendung mitbringt, und ist auf jeder Instanz gleich. Teil B sagt, was die Verwaltung sicherstellt, solange sie diese Instanz betreibt, etwa wo der Server steht, wer an ihn kommt und wohin gesichert wird.

Teil B und die Unterauftragsverarbeiter tragen Sie unter „Maßnahmen“ im Bereich der Instanz ein, je Unterauftragsverarbeiter Name, Leistung und Ort. Beides gilt für jeden Betreiber auf dieser Instanz und steht in seinem Dokument, sobald er es neu erzeugt. Solange Teil B fehlt, sagt das Dokument es. Den Mailserver eines Betreibers trägt dieser selbst ein; er gehört nicht hierher.

## Signatur der PDFs

Jedes PDF, das eine Unterschrift zeigt, signiert die Instanz, wenn es entsteht: ein Nachweis, ein Leistungsnachweis, eine Pflichtenübertragung. Die Signatur stammt von der Instanz, nicht von einer Person. Unter „Einstellungen“ im Bereich der Instanz steht, für wen das Zertifikat ausgestellt ist, seit wann die Instanz damit signiert, sein Fingerabdruck (SHA-256) und die früheren Zertifikate.

Den Fingerabdruck zeigt jedes PDF-Programm bei den Angaben zur Signatur. Stimmt er mit dem hier überein, kommt das PDF von dieser Instanz. Einen Betreiber, der ein PDF prüfen will, verweisen Sie auf „PDF prüfen“ im Büro: dort sagt die Instanz selbst, ob es ihre Signatur trägt und seitdem unverändert ist.

„Neuen Schlüssel erzeugen“ ersetzt den Schlüssel, etwa wenn er in falsche Hände geraten sein könnte. Jedes PDF, das danach entsteht, trägt die Signatur des neuen Schlüssels. PDFs mit der bisherigen Signatur bleiben gültig, und die Instanz erkennt sie weiter als ihre.

Der Schlüssel liegt verschlüsselt mit `SESSION_SECRET` der Instanz. Wird `SESSION_SECRET` getauscht, lässt er sich nicht mehr öffnen, und mit dem nächsten PDF entsteht ein neuer.
