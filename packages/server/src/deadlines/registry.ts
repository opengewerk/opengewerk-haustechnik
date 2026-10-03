import {
  type ApplicationDeadlineKind,
  deadlineActions,
  deadlineKinds,
  deadlineRegistry,
  type DeadlineRegistry,
  deadlineSources,
} from '@opengewerk/haustechnik-domain'

/**
 * The kinds of deadline this application knows, checked when the server
 * starts: a kind with a problem, or a source or action this application does
 * not know, stops the start rather than remind of the wrong thing later.
 */
export const deadlineKindRegistry: DeadlineRegistry<ApplicationDeadlineKind> = deadlineRegistry(
  deadlineKinds,
  { sources: [...deadlineSources], actions: [...deadlineActions] },
)
