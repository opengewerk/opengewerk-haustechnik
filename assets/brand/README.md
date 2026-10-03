# Laufzeit-Assets der Anwendung

Symbole, Favicon und die Größen für die beiden Manifeste. Quelle und alle weiteren Varianten: `opengewerk/.github` → `brand/`. Änderungen zuerst dort, dann hierher kopieren.

Diese Kopie ist Absicht und kein Versehen: die Anwendung läuft selbst betrieben und darf ihre Symbole nicht zur Laufzeit von GitHub nachladen. Alle anderen Stellen binden das Branding per Raw-URL ein, damit es nur eine Quelle gibt. Die Haustechnik trägt dieselbe Bildmarke wie die Handwerkersoftware; ihr Name steht im Titel und in den Manifesten.

| Datei | Verwendung |
| --- | --- |
| `opengewerk-app-icon.svg` | App-Icon als Vektor |
| `opengewerk-app-icon-192.png`, `opengewerk-app-icon-512.png` | Icons für die Manifeste |
| `opengewerk-icon.svg`, `opengewerk-icon-dark.svg`, `opengewerk-icon-mono.svg` | Bildmarke transparent, hell, dunkel, einfarbig |
| `opengewerk-icon-16.png`, `opengewerk-icon-32.png` | Kleine Rasterversionen |
| `favicon.ico` | Favicon mit 16, 32 und 48 px |

Die Dateien werden unverändert übernommen. Wer hier etwas zuschneidet, skaliert oder umfärbt, erzeugt eine zweite Wahrheit.
