import { Map } from 'lucide-react'

/**
 * The area a record lies in, beside its title: `area_chip()` of the boards.
 * Small and grey on purpose. It says where the record belongs and is no
 * state of it, so it carries none of the colours a state has.
 */
export function AreaBadge({ name }: { readonly name: string }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-[3px] border border-line bg-surface-sunken px-[7px] py-px text-[12px] font-semibold whitespace-nowrap text-ink-muted">
      <Map size={12} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
      Bereich {name}
    </span>
  )
}
