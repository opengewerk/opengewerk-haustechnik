import { pushEntries, pushOccasions } from '@opengewerk/haustechnik-domain'
import { pushSchema } from '@opengewerk/platform-server'

/**
 * Push to the devices of the people of an operator (#126). The devices, the
 * occasions somebody switched off and the outbox are the foundation's
 * (`pushSchema`, ADR 0010 in the repository opengewerk); the entries and the
 * occasions are this application's: a device works in the office or on site,
 * and the occasions are the five of `pushOccasions` in `domain`. The
 * foundation adds its test message from "Konto" at the end.
 */
export const push = pushSchema({ entries: pushEntries, occasions: pushOccasions })

export const { pushEntry, pushKind, pushStatus, pushSubscriptions, pushOptOuts, pushOutbox } = push
