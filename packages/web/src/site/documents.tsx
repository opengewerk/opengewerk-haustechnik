import { Button, Panel } from '@opengewerk/platform-web'
import { openVersion, useVersions } from '@opengewerk/platform-web/attachments'
import { useRight } from '@opengewerk/platform-web/session'
import { SiteText, SiteTrouble } from '@opengewerk/platform-web/site'
import { text, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { Camera } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import {
  type DocumentPlace,
  documentsAt,
  documentWords,
  fileDocument,
  newestFirst,
  versionWords,
} from '../app/documents.js'

export const siteDocumentWords = {
  takePhoto: 'Foto aufnehmen',
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
 */
export function SiteDocuments({
  place,
  empty,
}: {
  /** The record the documents hang on, with its property. */
  readonly place: DocumentPlace
  /** What stands there while nothing is filed. */
  readonly empty: string
}) {
  const client = useSync()
  const reads = useRight('document.read')
  const files = useRight('document.record')
  const documents = useRecords('attachments')
  const versions = useVersions()
  const field = useRef<HTMLInputElement>(null)
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
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {files ? (
          <>
            <input
              ref={field}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label={siteDocumentWords.photoField}
              onChange={(event) => {
                const file = event.target.files?.[0]

                // The same photo taken twice is a change of the field again.
                event.target.value = ''

                if (!file) {
                  return
                }

                setTrouble(null)
                void fileDocument(client, place, file)
                  .then((filed) => {
                    if (filed === null) {
                      setTrouble(siteDocumentWords.notFiled)
                    }
                  })
                  .catch(() => {
                    setTrouble(siteDocumentWords.notFiled)
                  })
              }}
            />
            <Button
              wide
              height={52}
              icon={Camera}
              onClick={() => {
                field.current?.click()
              }}
            >
              {siteDocumentWords.takePhoto}
            </Button>
          </>
        ) : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </div>
    </Panel>
  )
}
