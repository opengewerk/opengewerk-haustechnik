import { stockUnitLabel, type WorkOrderMaterialLine } from '@opengewerk/haustechnik-domain'
import { Cell, Column, TablePanel } from '@opengewerk/platform-web'
import { amount, date } from '@opengewerk/platform-web/format'
import { Link } from '@tanstack/react-router'

import { storePlaces } from './store-addresses.js'

/**
 * "Material" on the page of a work order in the office (#326, the board
 * "Auftrag mit Abnahme und Material"): what was taken on site, how much of
 * which article, from which store, on which day. No person and no price. A
 * withdrawal stays booked, after a rejection as well; what is wrong, a count
 * in the store sets right.
 */

export const materialPanelWords = {
  title: 'Material',
  caption: 'Material mit Menge, Artikel, Lager und Tag',
  note: 'Entnommen vor Ort. Eine Entnahme bleibt gebucht; was nicht stimmt, berichtigt eine Zählung im Lager.',
} as const

export function MaterialPanel({
  materials,
}: {
  readonly materials: readonly WorkOrderMaterialLine[]
}) {
  if (materials.length === 0) {
    return null
  }

  const quantity = (line: WorkOrderMaterialLine) =>
    `${amount(line.quantityMilli)} ${stockUnitLabel[line.unit]}`

  return (
    <TablePanel
      title={materialPanelWords.title}
      caption={materialPanelWords.caption}
      note={materialPanelWords.note}
      cards={materials.map((line) => ({
        key: line.id,
        title: `${quantity(line)} ${line.designation}`,
        sub: [line.number, line.store, date(line.takenOn)].join(' · '),
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[90px] min-w-[80px] text-right">Menge</Column>
          <Column className="min-w-[180px]">Artikel</Column>
          <Column className="w-[190px] min-w-[150px]">Lager</Column>
          <Column className="w-[100px] min-w-[96px]">Tag</Column>
        </tr>
      </thead>
      <tbody>
        {materials.map((line) => (
          <tr key={line.id}>
            <Cell className="text-right font-semibold tabular-nums">{quantity(line)}</Cell>
            <Cell>
              <Link to={storePlaces.article(line.storeId, line.articleId)}>{line.designation}</Link>{' '}
              <span className="text-ink-faint">{line.number}</span>
            </Cell>
            <Cell>{line.store}</Cell>
            <Cell>{date(line.takenOn)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
