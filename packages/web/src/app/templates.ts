import type { RecordState, TemplateDefinition } from '@opengewerk/haustechnik-domain'

/**
 * The definition a version of a template keeps (#112), as this device holds
 * it: a value of JSON travels as its text (ADR 0006), so it is read here, and
 * one that cannot be read is a template without chapters, which nobody fills
 * in.
 */
export function definitionOf(version: RecordState | null | undefined): TemplateDefinition {
  const kept = version?.['definition']

  if (typeof kept !== 'string') {
    return { title: '', sections: [] }
  }

  try {
    return JSON.parse(kept) as TemplateDefinition
  } catch {
    return { title: '', sections: [] }
  }
}
