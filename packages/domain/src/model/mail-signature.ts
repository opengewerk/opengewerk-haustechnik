/**
 * The signature under a message of an operator (#126).
 *
 * One placeholder, and on purpose not more. `{benutzer}` is the one thing an
 * operator cannot write down once, because the person a message is sent by
 * changes with the message. Everything else an operator wants under its mail,
 * its name, its department, its address, it writes as it is.
 */
export const signaturePlaceholders = ['{benutzer}'] as const

export type SignaturePlaceholder = (typeof signaturePlaceholders)[number]

/** How long a signature may be. A name and a few lines, not a newsletter. */
export const signatureMaxLength = 2000

/**
 * The placeholders in a signature that are not the known one, as they were
 * written. `{Benutzer}` is one of them, and so is `{name}`: a placeholder
 * that stayed in a message as it was typed is the mistake this is here for,
 * and it is caught when the signature is saved rather than when the first
 * person reads it.
 */
export function unknownPlaceholders(template: string): readonly string[] {
  const written = template.match(/\{[^{}\n]*\}/g) ?? []
  const known: readonly string[] = signaturePlaceholders

  return [...new Set(written.filter((token) => !known.includes(token)))]
}

/** What is wrong with a signature as typed, in a sentence, or null. */
export function signatureProblem(signature: string): string | null {
  const unknown = unknownPlaceholders(signature)

  if (unknown.length > 0) {
    return (
      `In der Signatur steht ${unknown.join(', ')}. Möglich ist {benutzer} für den Namen ` +
      'dessen, der die E-Mail verschickt.'
    )
  }

  return signature.length > signatureMaxLength
    ? `Die Signatur ist länger als ${String(signatureMaxLength)} Zeichen.`
    : null
}

/**
 * The signature under one message.
 *
 * `sender` is the person a message goes out for: whoever invited somebody. A
 * message nobody sent by hand, a deadline that reminds, has none. Every line
 * that names the sender is then left out, rather than printed with a gap
 * where the name would be, and the blank lines around it close up. An
 * operator that has written no signature signs with its name.
 */
export function renderSignature(
  template: string | null,
  facts: { readonly operator: string; readonly sender: string | null },
): string {
  if (template === null || template.trim() === '') {
    return facts.operator
  }

  return template
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => facts.sender !== null || !line.includes('{benutzer}'))
    .map((line) => line.replaceAll('{benutzer}', facts.sender ?? '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
