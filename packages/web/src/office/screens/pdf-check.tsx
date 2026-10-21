import {
  type PdfCheck,
  pdfCheckType,
  type PdfInstanceSignature,
  type PdfKept,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import { PageHead, Screen } from '@opengewerk/platform-web/office'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Info, ShieldCheck, TriangleAlert, Upload } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { dutyRegisterPlace } from '../duty-addresses.js'

/** What the page says, so that a test reads the same sentences. */
export const pdfCheckScreenWords = {
  sub:
    'Ob ein PDF ein aufbewahrter Druck dieser Instanz ist und ob es seit ihrer Signatur ' +
    'unverändert ist. Die Datei wird nur gelesen, nicht gespeichert.',
  choose: 'PDF auswählen',
  checking: 'Wird geprüft.',
  failed: 'Die Prüfung kam nicht an.',
  notPdf: 'Diese Datei ist kein PDF.',
  keptTitle: 'Aufbewahrter Druck',
  notKeptTitle: 'Kein aufbewahrter Druck',
  notKept:
    'Unter den Drucken, die Sie sehen, ist diese Datei nicht. Eine Pflichtenübertragung, eine ' +
    'Auskunft und ein Verzeichnis des Tages werden nicht aufbewahrt; für sie zählt die Signatur.',
  signedTitle: 'Signatur dieser Instanz',
  changedTitle: 'Nach der Signatur verändert',
  unsignedTitle: 'Keine Signatur dieser Instanz',
  unsigned:
    'Diese Datei trägt keine Signatur dieser Instanz. Ein Druck, der vor der Signatur ' +
    'aufbewahrt wurde, hat keine; dann zählt allein, ob er ein aufbewahrter Druck ist.',
} as const

const keptKinds: Readonly<Record<PdfKept['kind'], string>> = {
  evidence: 'der Druck von Nachweis',
  signed_evidence: 'das höher signierte PDF von Nachweis',
  round: 'der Druck des Rundgangs',
  service_report: 'der Leistungsnachweis zum Auftrag',
}

function keptSentence(kept: PdfKept): string {
  return `Diese Datei ist Byte für Byte ${keptKinds[kept.kind]} ${kept.title}, aufbewahrt seit ${moment(kept.keptAt)}.`
}

function keptLink(kept: PdfKept): ReactNode {
  const to =
    kept.evidenceId !== null
      ? `/nachweise/${kept.evidenceId}`
      : kept.activityId === null
        ? null
        : kept.kind === 'round'
          ? `/rundgaenge/${kept.activityId}`
          : `/auftraege/${kept.activityId}`

  return to === null ? null : (
    <Link to={to} className="text-[13px] underline">
      {kept.evidenceId !== null
        ? 'Nachweis öffnen'
        : kept.kind === 'round'
          ? 'Rundgang öffnen'
          : 'Auftrag öffnen'}
    </Link>
  )
}

function at(signedAt: string | null): string {
  return signedAt === null ? '' : ` am ${moment(signedAt)}`
}

function signatureFinding(signature: PdfInstanceSignature): {
  readonly tone: 'done' | 'conflict' | 'muted'
  readonly title: string
  readonly text: string
} {
  switch (signature.state) {
    case 'unchanged':
      return {
        tone: 'done',
        title: pdfCheckScreenWords.signedTitle,
        text: `Signiert von dieser Instanz${at(signature.signedAt)}. Seitdem unverändert.`,
      }
    case 'signed_after':
      return {
        tone: 'done',
        title: pdfCheckScreenWords.signedTitle,
        text:
          `Signiert von dieser Instanz${at(signature.signedAt)}, danach signiert von ` +
          `${signature.by.filter((name) => name !== '').join(' und ') || 'einer weiteren Stelle'}. ` +
          'Seitdem unverändert.',
      }
    case 'changed':
      return {
        tone: 'conflict',
        title: pdfCheckScreenWords.changedTitle,
        text:
          `Die Datei trägt die Signatur dieser Instanz${signature.signedAt === null ? '' : ` vom ${moment(signature.signedAt)}`}, ` +
          'aber sie wurde danach verändert. Was sie jetzt zeigt, stammt nicht so aus dieser Instanz.',
      }
    case 'none':
      return {
        tone: 'muted',
        title: pdfCheckScreenWords.unsignedTitle,
        text: pdfCheckScreenWords.unsigned,
      }
  }
}

const toneColour = {
  done: 'text-done',
  conflict: 'text-conflict',
  muted: 'text-ink-muted',
} as const

function Finding({
  tone,
  icon,
  title,
  children,
}: {
  readonly tone: keyof typeof toneColour
  readonly icon: ReactNode
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-px shrink-0 ${toneColour[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <strong className="text-[14px]">{title}</strong>
        {children}
      </div>
    </div>
  )
}

function Result({ check }: { readonly check: PdfCheck }) {
  if (!check.pdf) {
    return (
      <p role="alert" className="text-[13px] font-semibold text-conflict">
        {pdfCheckScreenWords.notPdf}
      </p>
    )
  }

  const signature = signatureFinding(check.instance)
  const icon = (tone: 'done' | 'conflict' | 'muted', kind: 'kept' | 'signature') =>
    tone === 'conflict' ? (
      <TriangleAlert size={18} strokeWidth={2.2} />
    ) : tone === 'muted' ? (
      <Info size={18} strokeWidth={2.2} />
    ) : kind === 'kept' ? (
      <Check size={18} strokeWidth={2.2} />
    ) : (
      <ShieldCheck size={18} strokeWidth={2.2} />
    )

  return (
    <Panel title="Ergebnis" roomy>
      <div role="status" className="flex flex-col gap-3.5">
        {check.kept === null ? (
          <Finding
            tone="muted"
            icon={icon('muted', 'kept')}
            title={pdfCheckScreenWords.notKeptTitle}
          >
            <span className="text-[13px] leading-[1.45]">{pdfCheckScreenWords.notKept}</span>
          </Finding>
        ) : (
          <Finding tone="done" icon={icon('done', 'kept')} title={pdfCheckScreenWords.keptTitle}>
            <span className="text-[13px] leading-[1.45]">{keptSentence(check.kept)}</span>
            {keptLink(check.kept)}
          </Finding>
        )}
        <div className="h-px bg-line" />
        <Finding
          tone={signature.tone}
          icon={icon(signature.tone, 'signature')}
          title={signature.title}
        >
          <span className="text-[13px] leading-[1.45]">{signature.text}</span>
        </Finding>
      </div>
    </Panel>
  )
}

function checked(file: File): Promise<PdfCheck> {
  return request<PdfCheck>('/pdf-checks', {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': pdfCheckType },
  })
}

/**
 * "PDF prüfen" (#457, board `HT-Buero-PDF-Pruefen`): a PDF somebody lays
 * before the office, checked against the prints kept here and the signature
 * of the instance. Reached from the register of duties, beside
 * "Nachweisverzeichnis", under the right to see the evidence.
 */
export function PdfCheckScreen() {
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<File | null>(null)
  const check = useMutation({ mutationFn: checked })

  return (
    <Screen>
      <PageHead
        title="PDF prüfen"
        crumbs={[dutyRegisterPlace]}
        phoneBack={dutyRegisterPlace}
        sub={pdfCheckScreenWords.sub}
      />
      <Panel roomy>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            icon={Upload}
            disabled={check.isPending}
            onClick={() => {
              input.current?.click()
            }}
          >
            {pdfCheckScreenWords.choose}
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            aria-label={pdfCheckScreenWords.choose}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]

              event.target.value = ''

              if (file !== undefined) {
                setPicked(file)
                check.mutate(file)
              }
            }}
          />
          {picked === null ? null : (
            <span className="text-[13px] text-ink-muted">
              {picked.name}, {Math.max(1, Math.round(picked.size / 1000))} KB
            </span>
          )}
        </div>
      </Panel>
      {check.isPending ? (
        <p className="text-[13px] text-ink-muted">{pdfCheckScreenWords.checking}</p>
      ) : check.isError ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {check.error instanceof RequestRefused ? check.error.message : pdfCheckScreenWords.failed}
        </p>
      ) : check.data === undefined ? null : (
        <Result check={check.data} />
      )}
    </Screen>
  )
}
