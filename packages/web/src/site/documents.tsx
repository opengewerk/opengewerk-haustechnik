import type { TravelPlace } from '@opengewerk/haustechnik-domain'
import { Panel } from '@opengewerk/platform-web'
import { openVersion, useVersions } from '@opengewerk/platform-web/attachments'
import { PhotoTaker } from '@opengewerk/platform-web/forms'
import { useRight } from '@opengewerk/platform-web/session'
import { SiteText, SiteTrouble } from '@opengewerk/platform-web/site'
import { text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useMemo, useState } from 'react'

import {
  type DocumentPlace,
  documentsAt,
  documentWords,
  fileDocument,
  newestFirst,
  versionWords,
} from '../app/documents.js'
import { siteTravelWords, TravelControl, useOnDevice } from './travel.js'

export const siteDocumentWords = {
  /** What the field behind the button is called, which nobody sees: the camera of the phone answers it. */
  photoField: 'Foto für die Dokumente',
  notFiled: 'Das Foto ließ sich nicht ablegen.',
  notOpened:
    'Die Datei ließ sich nicht öffnen. Ohne Verbindung liegt auf dem Gerät nur, was hier aufgenommen wurde.',
} as const

/**
 * The documents at a record on site (#99, 4.10 of the concept): what is
 * filed there, the one changed last first, and the button that takes a photo
 * and files it, also without a network. The photo waits on the device with
 * its bytes and goes up with the next exchange (#97).
 *
 * No screen names who filed a version, and none the time of day (section 3.9
 * of the description of the procedure): a line gives the day, or says that
 * the file has not gone up yet.
 *
 * The button is the field of a file behind a button, which a phone answers
 * with its camera. It opens nothing by itself: the camera comes with the tap.
 *
 * At an asset and a room the documents can be kept on the device for the
 * road (#348): the newest version of each then says that it lies here, and
 * opens without a network.
 */
export function SiteDocuments({
  place,
  empty,
  travel,
}: {
  /** The record the documents hang on, with its property. */
  readonly place: DocumentPlace
  /** What stands there while nothing is filed. */
  readonly empty: string
  /** The place as the road names it, where its documents can be kept for it. */
  readonly travel?: TravelPlace
}) {
  const client = useSync()
  const reads = useRight('document.read')
  const files = useRight('document.record')
  const documents = useRecords('attachments')
  const versions = useVersions()
  const onDevice = useOnDevice()
  const [trouble, setTrouble] = useState<string | null>(null)
  const here = useMemo(
    () => newestFirst(documentsAt(documents, place), versions),
    [documents, versions, place],
  )

  if (!reads) {
    return null
  }

  return (
    <Panel title="Dokumente">
      <div className="flex flex-col gap-2.5">
        {here.length === 0 ? (
          <SiteText muted>{empty}</SiteText>
        ) : (
          <ul aria-label="Dokumente" className="flex flex-col">
            {here.map((document) => {
              const id = String(document['id'])
              const all = versions.get(id) ?? []
              const newest = all[0]

              return (
                <li key={id} className="border-b border-row py-2">
                  {newest ? (
                    <button
                      type="button"
                      className="relative text-left text-[17px] font-semibold text-copper-text underline underline-offset-2 [overflow-wrap:anywhere] before:absolute before:inset-x-0 before:-inset-y-2.5"
                      onClick={() => {
                        setTrouble(null)
                        void openVersion(client, newest).catch(() => {
                          setTrouble(siteDocumentWords.notOpened)
                        })
                      }}
                    >
                      {text(document, 'title')}
                    </button>
                  ) : (
                    <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                      {text(document, 'title')}
                    </span>
                  )}
                  <span className="block text-[15px] leading-[1.35] text-ink-muted [overflow-wrap:anywhere]">
                    {newest ? versionWords(client, newest, all.length) : documentWords.onItsWay}
                    {travel && newest && onDevice(text(newest, 'sha256'))
                      ? siteTravelWords.onDevice
                      : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {travel ? <TravelControl place={travel} /> : null}
        {files ? (
          // Each photo a document of its own, from the gallery several at once (#458).
          <PhotoTaker
            label={siteDocumentWords.photoField}
            multiple
            onTake={(file) => {
              setTrouble(null)
              // Null is a photo on its way; a sentence says why it is not.
              void fileDocument(client, place, file)
                .then((problem) => {
                  if (problem !== null) {
                    setTrouble(problem)
                  }
                })
                .catch(() => {
                  setTrouble(siteDocumentWords.notFiled)
                })
            }}
          />
        ) : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </div>
    </Panel>
  )
}
