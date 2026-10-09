import {
  defaultKeyDay,
  type IsoDate,
  keyDateFor,
  meterFigure,
  meterUnitSymbol,
} from '@opengewerk/haustechnik-domain'
import { Button } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { FigureBlock } from '@opengewerk/platform-web/forms'
import { useRight } from '@opengewerk/platform-web/session'
import { SiteActionBar, SiteHeader, SiteScreen, SiteText } from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useDeferredWrite } from '../../app/form-points.js'
import { type HeldMeter, judgedFigure, readingStanding, useHeldMeters } from '../../app/meters.js'
import { titleOfRoom } from '../../app/place-records.js'
import { NotOnDevice } from '../kit.js'
import { toStart } from './form.js'

export const readingRoundWords = {
  title: 'Ablesung',
  sub: (property: string, keyDate: IsoDate) => `${property}, Stichtag ${date(keyDate)}`,
  progress: (done: number, all: number) =>
    `${String(done)} von ${String(all)} ${all === 1 ? 'Zähler' : 'Zählern'} abgelesen`,
  stand: 'Stand',
  saved: 'gesichert',
  before: (figure: string, day: IsoDate) => `Vormonat: ${figure} am ${date(day)}`,
  noneBefore: 'Noch kein Stand vor diesem.',
  done: 'Fertig',
  about:
    'Eigene Runde für die Zähler einer Liegenschaft. Jeder Stand ist sofort auf dem Gerät gesichert.',
  none: 'Hier ist kein Zähler abzulesen: keiner ist auf diesem Gerät, oder jeder ist gesperrt oder ruht.',
  mayNot: 'Zähler abzulesen ist Ihnen nicht freigegeben.',
} as const

/** A meter of the round, with what it shows: its title and where it is. */
interface RoundMeter {
  readonly meter: HeldMeter
  readonly id: string
  readonly title: string
  readonly place: string
}

/**
 * A round of the meters on site (section 4.9 of the concept, #120,
 * `ablesung()` of the boards): the meters of a property, each with the
 * reading of the month before beside it, read one after the other. Every
 * reading is saved on the device as it is typed and reaches the server with
 * the next exchange, also without a network. A figure below the reading
 * before is not taken; one that jumps is taken once the person keeps it. A
 * meter that is locked or rests on its key date is not on the round.
 */
export function ReadingRoundScreen() {
  const { propertyId } = useParams({ strict: false }) as { propertyId: string }
  const navigate = useNavigate()
  const property = useRecord('properties', propertyId)
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const settings = useRecords('meter_settings')
  const held = useHeldMeters()
  const reads = useRight('reading.write')
  const day = today() as IsoDate
  const operatorDay = settings[0] === undefined ? defaultKeyDay : Number(settings[0]['keyDay'])
  const meters = useMemo((): RoundMeter[] => {
    const byId = (records: typeof rooms, id: string | null) =>
      id === null ? null : (records.find((record) => record['id'] === id) ?? null)

    return [...held.values()]
      .filter(
        (meter) =>
          meter.asset['propertyId'] === propertyId &&
          meter.lockReason === null &&
          !readingStanding(meter, day).rests,
      )
      .map((meter) => {
        const building = byId(buildings, maybeText(meter.asset, 'buildingId'))
        const room = byId(rooms, maybeText(meter.asset, 'roomId'))

        return {
          meter,
          id: text(meter.asset, 'id'),
          title: [maybeText(meter.asset, 'mark'), text(meter.asset, 'name')]
            .filter(Boolean)
            .join(' '),
          place: [
            building === null ? null : maybeText(building, 'name'),
            room === null ? null : titleOfRoom(room),
          ]
            .filter(Boolean)
            .join(', '),
        }
      })
      .sort((left, right) => left.title.localeCompare(right.title, 'de'))
  }, [held, propertyId, buildings, rooms, day])

  if (property === null) {
    return <NotOnDevice what="Diese Liegenschaft" back={toStart} />
  }

  const done = meters.filter((each) => readingStanding(each.meter, day).taken).length
  const share = meters.length === 0 ? 0 : Math.round((done / meters.length) * 100)

  return (
    <>
      <SiteHeader
        title={readingRoundWords.title}
        sub={readingRoundWords.sub(text(property, 'name'), keyDateFor(day, operatorDay))}
        back={toStart}
      />
      <SiteScreen gap={12}>
        {meters.length === 0 ? (
          <SiteText muted>{readingRoundWords.none}</SiteText>
        ) : (
          <div>
            <div className="flex items-baseline justify-between gap-3 text-[15px] text-ink-muted">
              <span>{readingRoundWords.progress(done, meters.length)}</span>
              <span className="tabular-nums">{`${String(share)} %`}</span>
            </div>
            <div
              role="progressbar"
              aria-label={readingRoundWords.progress(done, meters.length)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={share}
              className="mt-2 h-1.5 overflow-hidden rounded-[3px] bg-surface-sunken"
            >
              <div className="h-full bg-copper" style={{ width: `${String(share)}%` }} />
            </div>
          </div>
        )}
        {reads ? null : <SiteText muted>{readingRoundWords.mayNot}</SiteText>}
        {meters.map((each) => (
          <MeterCard key={each.id} meter={each} day={day} editable={reads} />
        ))}
      </SiteScreen>
      <SiteActionBar>
        <div className="flex w-full flex-col gap-2.5">
          <Button
            tone="primary"
            wide
            height={60}
            icon={Check}
            onClick={() => {
              void navigate({ to: toStart.to })
            }}
          >
            {readingRoundWords.done}
          </Button>
          <p className="text-center text-[14px] leading-[1.4] text-ink-muted">
            {readingRoundWords.about}
          </p>
        </div>
      </SiteActionBar>
    </>
  )
}

/** One meter of the round: its reading, once saved on the device, or the box to type it in. */
function MeterCard({
  meter,
  day,
  editable,
}: {
  readonly meter: RoundMeter
  readonly day: IsoDate
  readonly editable: boolean
}) {
  const client = useSync()
  const standing = readingStanding(meter.meter, day)
  const taken = meter.meter.history.readings.find((reading) => reading.keyDate === standing.keyDate)
  const [shown, setShown] = useState<number | undefined>(taken?.valueMilli)
  const [judged, setJudged] = useState<{ refused: string | null; jump: string | null }>({
    refused: null,
    jump: null,
  })
  const [trouble, setTrouble] = useState<string | null>(null)
  const unit = meterUnitSymbol[meter.meter.unit]

  async function save(valueMilli: number, jumpConfirmed: boolean) {
    const made = await client.create('meter_readings', {
      assetId: meter.id,
      readOn: day,
      valueMilli,
      jumpConfirmed,
    })

    setTrouble(made.outcome === 'refused' ? refusalFor(made) : null)
  }

  const figure = useDeferredWrite((typed: number | undefined) => {
    if (typed === undefined || taken !== undefined) {
      setJudged({ refused: null, jump: null })

      return
    }

    const found = judgedFigure(meter.meter, day, typed)

    setJudged(found)

    if (found.refused === null && found.jump === null) {
      void save(typed, false)
    }
  })

  return (
    <section
      aria-label={meter.title}
      className="flex flex-col gap-2.5 rounded-[6px] border border-line bg-surface px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          <h2 className="text-[17px] leading-[1.3] font-bold [overflow-wrap:anywhere]">
            {meter.title}
          </h2>
          {meter.place === '' ? null : <p className="text-[14px] text-ink-muted">{meter.place}</p>}
        </div>
        {taken === undefined ? null : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-done">
            <Check size={16} strokeWidth={2.6} aria-hidden="true" />
            {readingRoundWords.saved}
          </span>
        )}
      </div>
      <div onBlur={figure.flush}>
        <FigureBlock
          label={readingRoundWords.stand}
          unit={unit}
          value={shown}
          disabled={!editable || taken !== undefined}
          doubt={
            judged.refused === null && judged.jump !== null && shown !== undefined
              ? {
                  text: judged.jump,
                  onKeep: () => {
                    setJudged({ refused: null, jump: null })
                    void save(shown, true)
                  },
                }
              : null
          }
          onChange={(typed) => {
            setShown(typed)
            figure.put(typed)
          }}
        />
      </div>
      {judged.refused === null && trouble === null ? null : (
        <p role="alert" className="text-[16px] leading-[1.4] font-semibold text-conflict">
          {judged.refused ?? trouble}
        </p>
      )}
      <p className="text-[15px] text-ink-muted">
        {standing.before === null
          ? readingRoundWords.noneBefore
          : readingRoundWords.before(
              meterFigure(standing.before.valueMilli, meter.meter.unit),
              standing.before.keyDate,
            )}
      </p>
    </section>
  )
}
