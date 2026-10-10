import { useButtonLook } from '@opengewerk/platform-web'
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** A link to a screen, dressed as a button, as the boards draw it: a way, not an action. */
export function LinkButton({
  to,
  search,
  icon: Icon,
  size = 'normal',
  label,
  children,
}: {
  readonly to: string
  readonly search?: Record<string, string>
  readonly icon?: LucideIcon
  readonly size?: 'normal' | 'small'
  /** What a reader hears, where the words on the button need the row they stand in. */
  readonly label?: string
  readonly children: ReactNode
}) {
  const look = useButtonLook('secondary', size)

  return (
    <Link
      to={to}
      {...(search === undefined ? {} : { search })}
      {...(label === undefined ? {} : { 'aria-label': label })}
      className={look}
    >
      {Icon ? (
        <Icon
          size={size === 'small' ? 13 : 15}
          strokeWidth={2.3}
          aria-hidden="true"
          className="shrink-0"
        />
      ) : null}
      {children}
    </Link>
  )
}
