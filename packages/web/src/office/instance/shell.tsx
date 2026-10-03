import { InstanceFrame } from '@opengewerk/platform-web/instance'
import type { InstanceEntry } from '@opengewerk/platform-web/instance'
import { History, House, Settings, Shield } from 'lucide-react'

/**
 * The screens of the area of the instance, by this application's words: the
 * tenants on it, the accounts of whoever runs it, and its log.
 */
const navigation: readonly InstanceEntry[] = [
  { to: '/instanz', label: 'Betreiber', icon: House },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/verwaltung', label: 'Verwaltung', icon: Shield },
  { to: '/instanz/protokoll', label: 'Protokoll', icon: History },
]

/**
 * The area of the instance in the office. Its frame and its screens are the
 * foundation's (ADR 0010 in the repository opengewerk); the router mounts
 * this as the route over them.
 */
export function InstanceShell() {
  return <InstanceFrame navigation={navigation} />
}
