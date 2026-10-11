/**
 * Where a list of the office is read as a table (#236): the address of its
 * page with `/table` behind the path, what it is narrowed by, and no page.
 * The route of the table reads the list whole, as the list reads a page.
 */
export function asTableAddress(listAddress: string): string {
  const [path = '', query = ''] = listAddress.split('?')
  const asked = new URLSearchParams(query)

  asked.delete('offset')
  asked.delete('limit')

  const rest = asked.toString()

  return `${path}/table${rest === '' ? '' : `?${rest}`}`
}
