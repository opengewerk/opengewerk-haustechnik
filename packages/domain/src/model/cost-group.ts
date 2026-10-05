/**
 * The cost groups of DIN 276 as far as the register of assets needs them: an
 * asset kind names the group of its assets with three digits (ADR 0002,
 * point 9), and a building is read by the groups one level above, 410 to
 * 490 under "Bauwerk, Technische Anlagen".
 */

/** What the groups of the second level under 400 are called in DIN 276. */
export const costGroupNames: Readonly<Record<string, string>> = {
  '410': 'Abwasser-, Wasser-, Gasanlagen',
  '420': 'Wärmeversorgungsanlagen',
  '430': 'Raumlufttechnische Anlagen',
  '440': 'Elektrische Anlagen',
  '450': 'Kommunikations-, sicherheits- und informationstechnische Anlagen',
  '460': 'Förderanlagen',
  '470': 'Nutzungsspezifische und verfahrenstechnische Anlagen',
  '480': 'Gebäude- und Anlagenautomation',
  '490': 'Sonstige Maßnahmen für technische Anlagen',
}

/** The group of the second level a cost group lies in: 461 lies in 460, and 460 in itself. */
export function costGroupAbove(costGroup: string): string {
  return `${costGroup.slice(0, 2)}0`
}

/**
 * Whether a cost group lies in another. A group whose number ends in zeros
 * holds every group that begins like it, 460 the groups 461 to 469 and 400
 * every group of the technical installations; any other holds itself alone.
 */
export function inCostGroup(costGroup: string, group: string): boolean {
  const stem = group.replace(/0+$/, '')

  return stem !== '' && costGroup.startsWith(stem)
}

/** "KG 460 Förderanlagen", and "KG 461" for a group this list has no name for. */
export function costGroupWords(group: string): string {
  const name = Object.hasOwn(costGroupNames, group) ? costGroupNames[group] : undefined

  return name === undefined ? `KG ${group}` : `KG ${group} ${name}`
}
