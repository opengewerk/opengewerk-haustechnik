import { type RecordState } from '@opengewerk/haustechnik-domain'
import { IconButton, Panel } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { NotSent, SiteRow, SiteRows, SiteText } from '@opengewerk/platform-web/site'
import { text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'

import {
  inverterWhat,
  inverterWhere,
  inModules,
  pvPlaces,
  pvWords,
  stringLine,
  useInverters,
  usePvStrings,
} from '../../app/photovoltaic.js'
import { sitePv } from '../places.js'
import { Count, FormButton } from './boards-block.js'

/**
 * The block "Wechselrichter" on the page of a PV installation on site (#461,
 * board "PV-Anlage mit ihren Wechselrichtern"): each inverter with what it is
 * and where it hangs, its pencil, and under it its strings, each a row that
 * opens the string; "String hinzufügen" puts a new one under this inverter,
 * and "Wechselrichter hinzufügen" one more inverter, also without a network.
 *
 * It lives apart from the pages of the strings (`pv.tsx`) so that the page of
 * an asset fetches it alone, and only for a PV installation, as it does the
 * boards of a low-voltage installation; neither is in the entry on site.
 */
export function SiteInvertersBlock({ assetId }: { readonly assetId: string }) {
  const records = useRight('asset.record')
  const inverters = useInverters(assetId)

  return (
    <Panel
      title="Wechselrichter"
      action={inverters.length === 0 ? null : <Count total={inverters.length} />}
    >
      <div className="flex flex-col gap-3.5">
        {inverters.length === 0 ? (
          <SiteText muted>{pvWords.noInverters}</SiteText>
        ) : (
          inverters.map((inverter) => (
            <InverterBlock
              key={String(inverter['id'])}
              assetId={assetId}
              inverter={inverter}
              records={records}
            />
          ))
        )}
        {records ? (
          <FormButton to={sitePv.newInverter(assetId)} icon={Plus}>
            Wechselrichter hinzufügen
          </FormButton>
        ) : null}
      </div>
    </Panel>
  )
}

/** An inverter in the list of its installation, `inverter_block()` of the board. */
function InverterBlock({
  assetId,
  inverter,
  records,
}: {
  readonly assetId: string
  readonly inverter: RecordState
  readonly records: boolean
}) {
  const navigate = useNavigate()
  const client = useSync()
  const id = String(inverter['id'])
  const name = text(inverter, 'designation')
  const own = usePvStrings(id)
  const modules = useRecords('pv_modules')
  const what = inverterWhat(inverter)
  const where = inverterWhere(inverter)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 border-b border-line pt-1 pb-2">
        <div className="min-w-0 grow">
          <div className="text-[17px] font-semibold [overflow-wrap:anywhere]">{name}</div>
          {what === '' ? null : (
            <div className="mt-0.5 text-[15px] leading-[1.35] text-ink-muted">{what}</div>
          )}
          {where === null && !client.isPending('inverters', id) ? null : (
            <div className="text-[15px] leading-[1.35] text-ink-muted">
              {where}
              {client.isPending('inverters', id) ? (
                <>
                  {where === null ? null : ', '}
                  <NotSent />
                </>
              ) : null}
            </div>
          )}
        </div>
        {records ? (
          <IconButton
            label={`${name} bearbeiten`}
            onClick={() => {
              void navigate({ to: sitePv.editInverter(assetId, id) })
            }}
          >
            <Pencil size={20} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      {own.length === 0 ? (
        <SiteText muted>{pvWords.noStrings}</SiteText>
      ) : (
        <div className="border-l-[3px] border-line pl-3">
          <SiteRows label={`Strings an ${name}`}>
            {own.map((pvString) => {
              const stringId = String(pvString['id'])

              return (
                <SiteRow
                  key={stringId}
                  to={pvPlaces.string(assetId, id, stringId)}
                  title={text(pvString, 'designation')}
                  meta={
                    <>
                      {stringLine(
                        pvString,
                        inModules(modules.filter((module) => module['pvStringId'] === stringId)),
                      )}
                      {client.isPending('pv_strings', stringId) ? (
                        <>
                          {', '}
                          <NotSent />
                        </>
                      ) : null}
                    </>
                  }
                />
              )
            })}
          </SiteRows>
        </div>
      )}
      {records ? (
        <FormButton
          to={sitePv.newString(assetId, id)}
          icon={Plus}
          label={`String hinzufügen an ${name}`}
        >
          String hinzufügen
        </FormButton>
      ) : null}
    </div>
  )
}
