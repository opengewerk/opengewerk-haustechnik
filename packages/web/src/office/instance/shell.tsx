import { InstanceFrame } from '@opengewerk/platform-web/instance'
import type { InstanceEntry } from '@opengewerk/platform-web/instance'
import { BookOpen, Building2, FileIcon, History, Settings, Users } from 'lucide-react'

import { manualPlace } from '../help.js'

/**
 * The screens of the area of the instance, by this application's words: the
 * tenants on it, the accounts of whoever runs it, its legal texts (#129), its
 * log, and the manual for running it (#131); by word and sign as `NAV` of the
 * page "Bereich der Instanz" draws them.
 */
const navigation: readonly InstanceEntry[] = [
  { to: '/instanz', label: 'Betreiber', icon: Building2 },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/verwaltung', label: 'Verwaltung der Instanz', icon: Users },
  { to: '/instanz/rechtstexte', label: 'Rechtstexte', icon: FileIcon },
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
