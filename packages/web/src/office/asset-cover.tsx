import type { IsoDate } from '@opengewerk/haustechnik-domain'
import { contractStandingLabel } from '@opengewerk/haustechnik-domain'
import { Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { assetContractsQuery, contractPlaces, orderWarrantiesQuery } from './contract-addresses.js'
import { workOrderPlaces } from './work-order-addresses.js'

/**
 * "Verträge und Gewährleistung" in the record of an asset (4.2, 4.11, #329),
 * `anlagenakte()` of the boards: the warranty of the asset itself, the
 * contracts that cover it or its building for whoever reads the contracts,
 * and the accepted work orders at it with a warranty of their own for
 * whoever reads the work. Each with the day it ends.
 */

export const coverWords = {
  title: 'Verträge und Gewährleistung',
  ownWarranty: 'Gewährleistung der Anlage',
  noWarranty: 'nicht angegeben',
  throughBuilding: 'über das Gebäude',
  noContract: 'Kein Vertrag erfasst die Anlage oder ihr Gebäude.',
  loading: 'Wird geladen.',
} as const

function Line({
  main,
  sub,
  to,
}: {
  readonly main: string
  readonly sub: string
  readonly to?: string
}) {
  return (
    <div className="leading-[1.35]">
      {to === undefined ? (
        <div className="text-[13px] font-medium">{main}</div>
      ) : (
        <Link to={to} className="text-[13px] font-medium">
          {main}
        </Link>
      )}
      <div className="text-[12px] text-ink-faint">{sub}</div>
    </div>
  )
}

/** "bis 03.09.2016, abgelaufen", "bis 12.03.2028". */
function untilWords(on: IsoDate): string {
  return on < today() ? `bis ${date(on)}, abgelaufen` : `bis ${date(on)}`
}

export function AssetCoverCard({
  assetId,
  warrantyEndsOn,
}: {
  readonly assetId: string
  readonly warrantyEndsOn: IsoDate | null
}) {
  const readsContracts = useRight('contract.read')
  const readsWork = useRight('activity.read')
  const contracts = useQuery({ ...assetContractsQuery(assetId), enabled: readsContracts })
  const orders = useQuery({ ...orderWarrantiesQuery(assetId), enabled: readsWork })

  return (
    <Panel title={coverWords.title}>
      <div className="flex flex-col gap-2">
        <Line
          main={coverWords.ownWarranty}
          sub={warrantyEndsOn === null ? coverWords.noWarranty : untilWords(warrantyEndsOn)}
        />
        {readsContracts
          ? (contracts.data ?? []).map((contract) => (
              <Line
                key={contract.id}
                main={contract.title}
                to={contractPlaces.contract(contract.id)}
                sub={[
                  contract.contractorName,
                  contract.throughBuilding ? coverWords.throughBuilding : null,
                  contract.standing === 'running' && contract.runsUntil !== null
                    ? `läuft bis ${date(contract.runsUntil)}`
                    : contractStandingLabel[contract.standing],
                ]
                  .filter((part) => part !== null)
                  .join(', ')}
              />
            ))
          : null}
        {readsContracts && contracts.data !== undefined && contracts.data.length === 0 ? (
          <p className="text-[12px] text-ink-faint">{coverWords.noContract}</p>
        ) : null}
        {readsWork
          ? (orders.data ?? []).map((order) => (
              <Line
                key={order.id}
                main={[order.number, order.title].filter(Boolean).join(' ')}
                to={workOrderPlaces.order(order.id)}
                sub={`Gewährleistung ${untilWords(order.warrantyEndsOn)}`}
              />
            ))
          : null}
      </div>
    </Panel>
  )
}
