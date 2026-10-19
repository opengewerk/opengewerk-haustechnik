import {
  type CircuitTable,
  circuitTablesOf,
  distributionBoardKindLabel,
  type EvidenceState,
} from '@opengewerk/haustechnik-domain'
import { Cell, Column, TablePanel } from '@opengewerk/platform-web'
import { TriangleAlert } from 'lucide-react'

/**
 * The measurements per circuit of an evidence as a table (#350, the board
 * "Nachweis einer Prüfung mit Messungen je Stromkreis"), read from the frozen
 * state alone, as the PDF prints them (`circuitTablesOf`): the circuits board
 * by board in the order of the chart, a column for each measured value, the
 * limit of the loop impedance worked out of each circuit beside it, and what
 * else the block said. A value outside its limit stands in the colour of a
 * conflict with its sign; the legend says where each limit comes from.
 */

export const circuitTableWords = {
  caption: (group: string) => `${group}: Messwerte, Grenzwerte und Bemerkungen je Stromkreis`,
  count: (circuits: number, boards: number) =>
    `${circuits === 1 ? '1 Stromkreis' : `${String(circuits)} Stromkreise`} aus ${
      boards === 1 ? '1 Verteiler' : `${String(boards)} Verteilern`
    }`,
  circuit: 'Stromkreis',
  limit: 'Grenzwert',
  remark: 'Bemerkung',
  unprotected: 'nicht erfasst',
  outside:
    'Außerhalb des Grenzwerts. Mit der Unterschrift wurde daraus ein Mangel an der Anlage, mit dem Stromkreis.',
  limits: (phrases: readonly string[]) => `Grenzwerte: ${phrases.join('; ')}.`,
  asSigned:
    'Die Stromkreise stehen mit ihren Angaben, wie sie bei der Unterschrift im Stromkreisverzeichnis standen; daran ist geurteilt.',
} as const

/** A symbol and a unit in the head of a column, which sets the rest in capitals. */
function AsWritten({ children }: { readonly children: string }) {
  return <span className="normal-case">{children}</span>
}

function MeasurementTable({ table }: { readonly table: CircuitTable }) {
  const span = 2 + table.columns.length + table.columns.filter((column) => column.withLimit).length
  const circuits = table.boards.reduce((sum, board) => sum + board.rows.length, 0)

  return (
    <TablePanel
      title={table.group}
      action={
        <span className="text-[12px] text-ink-muted">
          {circuitTableWords.count(circuits, table.boards.length)}
        </span>
      }
      caption={circuitTableWords.caption(table.group)}
      note={
        <div className="flex flex-col gap-1.5 leading-[1.45]">
          {table.anyOutside ? (
            <p className="flex items-center gap-1.5 font-semibold text-conflict">
              <TriangleAlert size={14} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
              {circuitTableWords.outside}
            </p>
          ) : null}
          {table.limits.length === 0 ? null : <p>{circuitTableWords.limits(table.limits)}</p>}
          <p>{circuitTableWords.asSigned}</p>
        </div>
      }
    >
      <thead>
        <tr>
          <Column>{circuitTableWords.circuit}</Column>
          {table.columns.flatMap((column) => [
            <Column key={column.label} numeric>
              <AsWritten>{`${column.symbol} ${column.unit}`.trim()}</AsWritten>
            </Column>,
            ...(column.withLimit
              ? [
                  <Column key={`${column.label}-limit`} numeric>
                    {circuitTableWords.limit}{' '}
                    <AsWritten>{`${column.symbol} ${column.unit}`.trim()}</AsWritten>
                  </Column>,
                ]
              : []),
          ])}
          <Column className="min-w-[200px]">{circuitTableWords.remark}</Column>
        </tr>
      </thead>
      <tbody>
        {table.boards.flatMap((board) => [
          <tr key={`board-${board.board}`}>
            <Cell colSpan={span} className="bg-ground">
              <span className="font-semibold">{board.board}</span>
              <span className="ml-2 text-ink-faint">
                {distributionBoardKindLabel[board.boardKind]}
              </span>
            </Cell>
          </tr>,
          ...board.rows.map(({ circuit, values, remarks }) => (
            <tr key={circuit.id}>
              <Cell>
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 font-semibold">{circuit.designation}</span>
                  <div className="min-w-0 leading-[1.35]">
                    <div className="font-medium [overflow-wrap:anywhere]">
                      {circuit.consumer ?? ''}
                    </div>
                    <div className="text-[12px] text-ink-faint">
                      {circuit.protection ?? circuitTableWords.unprotected}
                    </div>
                  </div>
                </div>
              </Cell>
              {values.flatMap((value, index) => [
                <Cell key={table.columns[index]?.label ?? index} numeric>
                  {value.outside ? (
                    <span className="inline-flex items-center gap-1 font-bold whitespace-nowrap text-conflict">
                      <TriangleAlert size={13} strokeWidth={2.4} aria-hidden="true" />
                      {value.figure}
                    </span>
                  ) : (
                    <span className="whitespace-nowrap">{value.figure}</span>
                  )}
                </Cell>,
                ...(value.limit === undefined
                  ? []
                  : [
                      <Cell
                        key={`${table.columns[index]?.label ?? String(index)}-limit`}
                        numeric
                        className="whitespace-nowrap text-ink-muted"
                      >
                        {value.limit}
                      </Cell>,
                    ]),
              ])}
              <Cell className="text-ink-muted [overflow-wrap:anywhere]">{remarks}</Cell>
            </tr>
          )),
        ])}
      </tbody>
    </TablePanel>
  )
}

/**
 * The tables of an evidence with measurements per circuit; nothing for any
 * other one, which names no circuits (a state before version 14 among them).
 */
export function CircuitMeasurements({ state }: { readonly state: EvidenceState }) {
  const circuits = state.circuits ?? []
  const tables = circuits.length === 0 ? [] : circuitTablesOf(state.answers, circuits)

  return tables.length === 0 ? null : (
    <>
      {tables.map((table) => (
        <MeasurementTable key={table.group} table={table} />
      ))}
    </>
  )
}
