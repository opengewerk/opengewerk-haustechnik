import { InstanceFrame } from '@opengewerk/platform-web/instance'
import type { InstanceEntry } from '@opengewerk/platform-web/instance'
import { BookOpen, History, House, Settings, Shield } from 'lucide-react'

import { manualPlace } from '../help.js'

/**
 * The screens of the area of the instance, by this application's words: the
 * tenants on it, the accounts of whoever runs it, its log, and the manual for
 * running it (#131).
 */
const navigation: readonly InstanceEntry[] = [
  { to: '/instanz', label: 'Betreiber', icon: House },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/verwaltung', label: 'Verwaltung', icon: Shield },
  { to: '/instanz/protokoll', label: 'Protokoll', icon: History },
  { to: manualPlace, label: 'Handbuch', icon: BookOpen },
]

/**
 * The area of the instance in the office. Its frame and its screens are the
 * foundation's (ADR 0010 in the repository opengewerk); the router mounts
 * this as the route over them.
 */
export function InstanceShell() {
  return <InstanceFrame navigation={navigation} />
}
