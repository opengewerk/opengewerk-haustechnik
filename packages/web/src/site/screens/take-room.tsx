import { roomProblems } from '@opengewerk/haustechnik-domain'
import { Button, Field } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { maybeText, refusalFor, text, useRecord, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { NotOffered, NotOnDevice } from '../kit.js'
import { sitePlaces, stockTaking } from '../places.js'

export const takeRoomWords = {
  mayNot: 'Räume aufnehmen gehört nicht zu den Rechten dieses Zugangs.',
  oneIsEnough: 'Eine Nummer oder eine Bezeichnung genügt.',
  check: 'Bitte prüfen Sie die markierten Felder.',
  saved: 'Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.',
} as const

/**
 * A room taken in on site, also without a network (#99, board "Raum
 * aufnehmen", 2.7 of the concept): its number, its name and what it is used
 * as, on the floor the address names. Building, property and area follow the
 * floor on the server. The rules are those of `domain`, asked here before
 * anything is queued, so that the server gives the same answer.
 */
export function TakeRoomScreen() {
  const { floorId } = useParams({ strict: false }) as { floorId?: string }
  const client = useSync()
  const navigate = useNavigate()
  const floor = useRecord('floors', floorId)
  const building = useRecord('buildings', maybeText(floor, 'buildingId') ?? undefined)
  const records = useRight('room.record')
  const [typed, setTyped] = useState({ number: '', name: '', use: '' })
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  if (!floor || floorId === undefined) {
    return (
      <NotOnDevice
        what="Dieses Geschoss"
        back={{ to: stockTaking.start, label: 'Zurück zu Aufnehmen' }}
      />
    )
  }

  const back = { to: sitePlaces.floor(floorId), label: 'Zurück zum Geschoss' }

  if (!records) {
    return (
      <NotOffered title="Raum aufnehmen" back={back}>
        {takeRoomWords.mayNot}
      </NotOffered>
    )
  }

  const set = (values: Partial<typeof typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    setTrouble(null)

    const wanted = {
      number: typed.number.trim() === '' ? null : typed.number,
      name: typed.name.trim() === '' ? null : typed.name,
      use: typed.use.trim() === '' ? null : typed.use,
    }
    const wrong = roomProblems(wanted)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(takeRoomWords.check)

      return
    }

    setWorking(true)

    try {
      const made = await client.create('rooms', { floorId, ...wanted })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      void navigate({ to: sitePlaces.room(made.id) })
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <SiteHeader
        title="Raum aufnehmen"
        sub={[maybeText(building, 'name'), text(floor, 'name')].filter(Boolean).join(', ')}
        back={back}
      />
      <SiteScreen>
        <Field
          label="Raumnummer"
          value={typed.number}
          {...(problems['number'] ? { problem: problems['number'] } : {})}
          onChange={(event) => {
            set({ number: event.target.value })
          }}
        />
        <Field
          label="Bezeichnung"
          value={typed.name}
          {...(problems['name'] ? { problem: problems['name'] } : {})}
          onChange={(event) => {
            set({ name: event.target.value })
          }}
        />
        <Field
          label="Nutzung"
          value={typed.use}
          {...(problems['use'] ? { problem: problems['use'] } : {})}
          onChange={(event) => {
            set({ use: event.target.value })
          }}
        />
        <SiteText muted size={15}>
          {takeRoomWords.oneIsEnough}
        </SiteText>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={takeRoomWords.saved}>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Check}
          disabled={working}
          onClick={() => {
            void save()
          }}
        >
          Anlegen
        </Button>
      </SiteActionBar>
    </form>
  )
}
