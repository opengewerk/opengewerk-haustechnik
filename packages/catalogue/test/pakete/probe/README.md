# Probepaket

Ein vollständiges Paket im Format von ADR 0005: zwei Anlagenarten, davon eine Messstelle, eine
Pflichtart aus staatlichem Recht und die Regel ihrer Frist, dazu Manifest und Abnahmen. Die Tests des Laders nehmen es als
Material, und wer ein Paket beiträgt, kann es als Vorbild nehmen: den Ordner nach
`pakete/<name>/` kopieren, das Manifest anpassen und die Einträge ersetzen. Wie ein Paket
aufgebaut ist, steht in `pakete/README.md`.

Es liegt nicht unter `pakete/`, weil alles dort mit der Anwendung ausgeliefert wird. Es ist neu
geschrieben und stammt aus keiner Vorlage eines Betreibers. Aufzug, Hauptprüfung und ihre Frist
sind am 03.10.2026 gegen den Text der BetrSichV geprüft. Der Wasserzähler trägt keine Pflicht und
nichts, was ein Gesetz vorgibt; er zeigt, wie eine Messstelle mit Medium und Einheit beschrieben
wird. Die Kostengruppen 461 und 412 sind nicht gegen den Text der DIN 276 geprüft, der nicht frei
vorliegt. Abgenommen hat niemand etwas; deshalb steht in `abnahmen.json` bei keinem Eintrag eine
Abnahme.
