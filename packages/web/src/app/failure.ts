/**
 * What a screen says when writing a file or a signature threw instead of
 * being turned down (#294). A refusal says its own sentence (`refusalFor`);
 * everything else went unsaid before, and whoever pressed the button saw
 * nothing happen, the keyboard on the page.
 *
 * Two causes are common enough to name. Over a connection that is not
 * encrypted the browser offers no SHA-256 (`crypto.subtle`), and a file or a
 * signature needs its fingerprint; the gate already says "Unverschlüsselt
 * verbunden". Otherwise it is the device, a full store above all.
 */
export const failureWords = {
  unencrypted:
    'Dateien und Unterschriften brauchen eine verschlüsselte Verbindung. Diese ist es nicht: ' +
    'bitte die Adresse mit https öffnen. Die Eingaben stehen noch da.',
  device: 'Auf diesem Gerät ließ sich das nicht festschreiben. Die Eingaben stehen noch da.',
} as const

/** The sentence for a write that threw, by what the browser offers. */
export function failureSentence(): string {
  return (globalThis.crypto as Crypto | undefined)?.subtle === undefined
    ? failureWords.unencrypted
    : failureWords.device
}
