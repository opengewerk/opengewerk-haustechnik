import {
  type RecordState,
  type StockUnit,
  stockUnitLabel,
  workOrderMaterialProblems,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, Panel, SelectField } from '@opengewerk/platform-web'
import { amount, parseQuantity } from '@opengewerk/platform-web/format'
import {
  SiteActionBar,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
  useCodeReading,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecords,
  useRelated,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check, ScanLine } from 'lucide-react'
import { useMemo, useState } from 'react'

import { beginActivity } from '../../app/answers.js'
import { articleOfCode, stockOnThisDevice } from '../../app/materials.js'
import { CameraFrame, CameraPicture, NotOnDevice, NotOffered } from '../kit.js'
import { siteForms } from '../places.js'
import { useWorkOrder } from './work-order.js'

/**
 * Material at a work order on site (#326, sections 4.8 and 4.12 of the
 * concept, the boards "Material entnehmen", "Material scannen" and "mehr als
 * im Lager"): the barcode of the manufacturer or the own label of a shelf,
 * the search as the fallback, the store and how much. The device holds the
 * whole stock of the operator, so all of it works without a network; the
 * server books the withdrawal once. Whoever works on the order takes
 * material, the further people included.
 */

export const materialWords = {
  title: 'Material',
  take: 'Material entnehmen',
  scanTitle: 'Material scannen',
  none: 'Noch kein Material entnommen.',
  notSent: 'noch nicht übertragen',
  scan: 'Strichcode oder Etikett scannen',
  search: 'Oder suchen',
  searchPlaceholder: 'Nummer, Bezeichnung oder EAN',
  found: 'Gefunden',
  article: 'Artikel',
  recognised: 'Erkannt',
  byEan: 'am Strichcode des Herstellers',
  byLabel: 'am Etikett des Fachs',
  bySearch: 'über die Suche',
  store: 'Lager',
  quantity: 'Menge',
  inStore: (now: string, after: string) => `Im Lager: ${now}, danach ${after}.`,
  inStoreShort: (now: string) => `Im Lager stehen laut diesem Gerät ${now}.`,
  belowZero: (after: string) =>
    `Entnommen wird trotzdem. Der Bestand steht danach bei ${after} und sagt es, bis eine Zählung ihn berichtigt.`,
  booking:
    'Die Entnahme ist eine Buchung am Auftrag. Geändert wird sie danach nicht; was nicht stimmt, berichtigt eine Zählung im Lager.',
  holdIntoTheFrame: 'Halten Sie den Strichcode in den Rahmen, oder das Etikett am Lagerfach.',
  unknownCode: 'Diesen Code kennt das Lager nicht. Bitte über die Suche wählen.',
  noReader: 'Dieses Gerät liest keine Strichcodes. Bitte über die Suche wählen.',
  noCamera: 'Die Kamera lässt sich nicht öffnen. Bitte über die Suche wählen.',
  noStore: 'Noch gibt es kein Lager. Das Büro legt es an.',
  cancel: 'Abbrechen',
  takeIt: 'Entnehmen',
  backToScan: 'Zurück',
  notTaken: 'Material nimmt dieser Auftrag nicht mehr.',
  quantityProblem: 'Die Menge ist eine Zahl über null, mit höchstens drei Stellen nach dem Komma.',
} as const

function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/** A quantity with its unit, as a person reads it: "2 Stück". */
function quantityOf(milli: number, unit: string): string {
  return `${amount(milli)} ${stockUnitLabel[unit as StockUnit] ?? ''}`.trim()
}

/** The material of an order on its page on site, the first taken first, and the way to take more. */
export function MaterialCard({
  activityId,
  editable,
}: {
  readonly activityId: string
  readonly editable: boolean
}) {
  const client = useSync()
  const navigate = useNavigate()
  const taken = useRelated('work_order_materials', 'activityId', activityId).filter(live)
  const articles = useRecords('articles')
  const stores = useRecords('stores')
  const lines = [...taken].sort((left, right) =>
    text(left, 'takenAt') < text(right, 'takenAt') ? -1 : 1,
  )

  return (
    <Panel title={materialWords.title}>
      {lines.length === 0 ? (
        <SiteText muted>{materialWords.none}</SiteText>
      ) : (
        <ul aria-label={materialWords.title} className="flex flex-col">
          {lines.map((line) => {
            const article = articles.find((each) => each['id'] === line['articleId'])
            const store = stores.find((each) => each['id'] === line['storeId'])
            const pending = client.isPending('work_order_materials', String(line['id']))

            return (
              <li key={String(line['id'])} className="border-b border-row py-2.5 last:border-b-0">
                <p className="text-[17px] leading-[1.4]">
                  {`${quantityOf(Number(line['quantityMilli']), text(article, 'unit'))} ${text(article, 'designation')}`}
                </p>
                <p className="mt-[3px] text-[14px] text-ink-muted">
                  {text(store, 'name')}
                  {pending ? (
                    <span className="font-semibold text-waiting">{` · ${materialWords.notSent}`}</span>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {editable ? (
        <div className="pt-3">
          <Button
            wide
            height={48}
            icon={ScanLine}
            onClick={() => {
              void navigate({ to: siteForms.material(activityId) })
            }}
          >
            {materialWords.take}
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}

type Recognised = 'ean' | 'label' | 'search'

/** Taking material for a work order: what, from where, how much. */
export function SiteMaterialScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const client = useSync()
  const navigate = useNavigate()
  const work = useWorkOrder(activityId)
  const articles = useRecords('articles')
  const stores = useRecords('stores').filter(live)
  // Read so that the stock below follows the bookings and labels as they arrive.
  useRecords('stock_movements')
  useRecords('store_labels')
  const [scanning, setScanning] = useState(false)
  const [search, setSearch] = useState('')
  const [articleId, setArticleId] = useState<string | null>(null)
  const [recognised, setRecognised] = useState<Recognised | null>(null)
  const [pickedStore, setStoreId] = useState('')
  // The first store until one is chosen: the stores may arrive after the screen.
  const storeId = pickedStore === '' ? String(stores[0]?.['id'] ?? '') : pickedStore
  const [quantity, setQuantity] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const back = { to: siteForms.form(activityId), label: 'Zurück zum Auftrag' }
  const article = articles.find((each) => each['id'] === articleId) ?? null
  const unit = text(article, 'unit') || 'piece'
  const words = search.trim().toLocaleLowerCase('de')
  const hits = useMemo(
    () =>
      words === ''
        ? []
        : articles
            .filter(live)
            .filter((each) =>
              [text(each, 'number'), text(each, 'designation'), maybeText(each, 'ean') ?? ''].some(
                (said) => said.toLocaleLowerCase('de').includes(words),
              ),
            )
            .slice(0, 8),
    [articles, words],
  )

  if (work.activity === null) {
    return <NotOnDevice what="Diesen Auftrag" back={{ to: '/', label: 'Zum Start' }} />
  }

  if (!work.editable) {
    return (
      <NotOffered title={materialWords.take} back={back}>
        {materialWords.notTaken}
      </NotOffered>
    )
  }

  if (scanning) {
    return (
      <MaterialCamera
        sub={[maybeText(work.order, 'number'), text(work.activity, 'title')]
          .filter(Boolean)
          .join(' ')}
        onCode={(read) => {
          const found = articleOfCode(client, read)

          setScanning(false)

          if (found === null) {
            setTrouble(materialWords.unknownCode)

            return
          }

          setTrouble(null)
          setArticleId(found.articleId)
          setRecognised(found.by)

          if (found.by === 'label') {
            setStoreId(found.storeId)
          }
        }}
        onBack={() => {
          setScanning(false)
        }}
      />
    )
  }

  const milli = parseQuantity(quantity)
  const now =
    article === null || storeId === '' ? null : stockOnThisDevice(client, storeId, articleId ?? '')
  const after = now === null || milli === null ? null : now - milli
  const activity = work.activity

  async function take() {
    const values = {
      activityId,
      storeId,
      articleId: articleId ?? '',
      quantityMilli: milli ?? 0,
      takenAt: new Date().toISOString(),
    }
    const wrong =
      milli === null || milli <= 0
        ? materialWords.quantityProblem
        : Object.values(workOrderMaterialProblems(values))[0]

    if (wrong !== undefined) {
      setTrouble(wrong)

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const begun = await beginActivity(client, activityId)

      if (begun !== null) {
        setTrouble(begun)

        return
      }

      const made = await client.create('work_order_materials', values)

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      void navigate({ to: back.to })
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SiteHeader
        title={materialWords.take}
        sub={[maybeText(work.order, 'number'), text(activity, 'title')].filter(Boolean).join(' ')}
        back={back}
      />
      <SiteScreen gap={14}>
        {stores.length === 0 ? <SiteText muted>{materialWords.noStore}</SiteText> : null}
        <div className="flex flex-col gap-2.5">
          <Button
            wide
            height={52}
            icon={ScanLine}
            onClick={() => {
              setTrouble(null)
              setScanning(true)
            }}
          >
            {materialWords.scan}
          </Button>
          <Field
            label={materialWords.search}
            type="search"
            value={search}
            placeholder={materialWords.searchPlaceholder}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
          {hits.length > 0 && articleId === null ? (
            <ul aria-label={materialWords.found} className="flex flex-col gap-1.5">
              {hits.map((hit) => (
                <li key={String(hit['id'])}>
                  <Button
                    wide
                    height={48}
                    onClick={() => {
                      setArticleId(String(hit['id']))
                      setRecognised('search')
                      setSearch('')
                    }}
                  >
                    {`${text(hit, 'number')} ${text(hit, 'designation')}`}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {article === null ? null : (
          <Panel>
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
                  {materialWords.article}
                </dt>
                <dd className="mt-0.5 text-[17px]">
                  {`${text(article, 'number')} ${text(article, 'designation')}`}
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
                  {materialWords.recognised}
                </dt>
                <dd className="mt-0.5 text-[17px]">
                  {recognised === 'ean'
                    ? materialWords.byEan
                    : recognised === 'label'
                      ? materialWords.byLabel
                      : materialWords.bySearch}
                </dd>
              </div>
            </dl>
          </Panel>
        )}
        <SelectField
          label={materialWords.store}
          value={storeId}
          options={stores.map((store) => ({
            value: String(store['id']),
            label: text(store, 'name'),
          }))}
          onChange={setStoreId}
        />
        <Field
          label={materialWords.quantity}
          numeric
          inputMode="decimal"
          unit={stockUnitLabel[unit as StockUnit]}
          value={quantity}
          {...(now === null
            ? {}
            : {
                hint:
                  after === null || after >= 0
                    ? after === null
                      ? materialWords.inStoreShort(quantityOf(now, unit))
                      : materialWords.inStore(quantityOf(now, unit), quantityOf(after, unit))
                    : materialWords.inStoreShort(quantityOf(now, unit)),
              })}
          onChange={(event) => {
            setQuantity(event.target.value)
          }}
        />
        {after !== null && after < 0 ? (
          <p className="rounded-[6px] border border-waiting-edge bg-waiting-fill px-3.5 py-3 text-[16px] leading-[1.45]">
            {materialWords.belowZero(quantityOf(after, unit))}
          </p>
        ) : (
          <SiteText muted size={15}>
            {materialWords.booking}
          </SiteText>
        )}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar>
        <div className="min-w-0 flex-[1_1_auto]">
          <Button
            wide
            height={60}
            onClick={() => {
              void navigate({ to: back.to })
            }}
          >
            {materialWords.cancel}
          </Button>
        </div>
        <div className="min-w-0 flex-[2_1_auto]">
          <Button
            tone="primary"
            wide
            height={60}
            icon={Check}
            disabled={working || articleId === null || storeId === '' || quantity.trim() === ''}
            onClick={() => {
              void take()
            }}
          >
            {materialWords.takeIt}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}

/** The camera while it looks for a barcode or the label of a shelf. */
function MaterialCamera({
  sub,
  onCode,
  onBack,
}: {
  readonly sub: string
  readonly onCode: (read: string) => void
  readonly onBack: () => void
}) {
  const { video, trouble } = useCodeReading(true, onCode, {
    noReader: materialWords.noReader,
    noCamera: materialWords.noCamera,
  })

  return (
    <>
      <SiteHeader title={materialWords.scanTitle} sub={sub} />
      <CameraFrame hint={trouble === null ? materialWords.holdIntoTheFrame : null}>
        <CameraPicture video={video} trouble={trouble} shape="wide" />
      </CameraFrame>
      <SiteActionBar>
        <div className="min-w-0 flex-1">
          <Button wide height={60} onClick={onBack}>
            {materialWords.backToScan}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}
