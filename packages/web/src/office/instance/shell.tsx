import { InstanceFrame } from '@opengewerk/platform-web/instance'
import type { InstanceEntry } from '@opengewerk/platform-web/instance'
import { House, Settings, Shield } from 'lucide-react'

/**
 * The screens of the area of the instance, by this application's words: the
 * tenants on it and the accounts of whoever runs it. The log of the area
 * comes with the change log of the foundation.
 */
const navigation: readonly InstanceEntry[] = [
  { to: '/instanz', label: 'Betreiber', icon: House },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/verwaltung', label: 'Verwaltung', icon: Shield },
]

/**
 * The area of the instance in the office. Its frame and its screens are the
 * foundation's (ADR 0010 in the repository opengewerk); the router mounts
 * this as the route over them.
 */
export function InstanceShell() {
  return <InstanceFrame navigation={navigation} />
}
