import { signatureLimits, signatureWayLabel, typedNameIsOf } from '@opengewerk/haustechnik-domain'
import { Button, Field, SignaturePicture } from '@opengewerk/platform-web'
import { SignaturePad } from '@opengewerk/platform-web/site'
import { Keyboard, PenLine } from 'lucide-react'
import { useState } from 'react'

/**
 * What somebody gives to sign (#209): the drawing, or their own name typed
 * to confirm. One of the two, never both, as the server takes it.
 */
export type GivenSignature =
  | { readonly path: string; readonly typedName: null }
  | { readonly path: null; readonly typedName: string }

export const signatureWayWords = {
  withoutDrawing: 'Ohne Schriftzug unterschreiben',
  withDrawing: 'Mit Schriftzug unterschreiben',
  typedName: 'Ihr Name',
  typedHint: (name: string) =>
    `Den eigenen Namen tippen, wie er im Konto steht: ${name}. Er gilt wie der Schriftzug für genau diese Seite.`,
  notYours: (name: string) =>
    `Bestätigt wird mit dem eigenen Namen, wie er im Konto steht: ${name}.`,
} as const

/**
 * The two ways to sign (section 2.6 of the concept): "mit dem Schriftzug auf
 * dem Gerät oder, wo das eine Hürde ist, ohne ihn: die Person bestätigt mit
 * ihrem getippten Namen."
 *
 * The pad takes a finger or a pen and nothing else, so the way without it is
 * a button beside the pad that a keyboard reaches. It stays where it is when
 * it switches, and the field it opens takes the focus, so the keyboard goes
 * on where the hand is. The name counts once it is the name of the account,
 * whatever the case and the spaces; until then nothing is given.
 *
 * Without the name of the account on this device the second way is not
 * offered: nothing typed could be confirmed against it.
 */
export function SignatureWays({
  label,
  name,
  onChange,
}: {
  /** The name of the pad, as a screen reader announces it. */
  readonly label: string
  /** The name of the account signed in, which the typed name has to be. */
  readonly name: string
  /** What is given as it stands after each change, or null while nothing counts. */
  readonly onChange: (given: GivenSignature | null) => void
}) {
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [left, setLeft] = useState(false)
  const problem =
    left && typed.trim() !== '' && !typedNameIsOf(typed, name)
      ? signatureWayWords.notYours(name)
      : undefined

  function switchWay() {
    setTyping(!typing)
    setTyped('')
    setLeft(false)
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-2">
      {typing ? (
        <Field
          label={signatureWayWords.typedName}
          hint={signatureWayWords.typedHint(name)}
          problem={problem}
          value={typed}
          maxLength={signatureLimits.typedName}
          autoComplete="name"
          spellCheck={false}
          // The field opens on the press of the button next to it, and the
          // keyboard that pressed it types here next.
          autoFocus
          onChange={(event) => {
            const next = event.target.value

            setTyped(next)
            onChange(
              typedNameIsOf(next, name)
                ? { path: null, typedName: next.trim().replace(/\s+/g, ' ') }
                : null,
            )
          }}
          onBlur={() => {
            setLeft(true)
          }}
        />
      ) : (
        <SignaturePad
          label={label}
          onChange={(path) => {
            onChange(path === null ? null : { path, typedName: null })
          }}
        />
      )}
      {name === '' ? null : (
        <div>
          <Button icon={typing ? PenLine : Keyboard} onClick={switchWay}>
            {typing ? signatureWayWords.withDrawing : signatureWayWords.withoutDrawing}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * A signature as a page of the office shows it in its box: the drawing, or
 * the typed name, which says beside it which way it was (#209).
 */
export function SignatureMark({
  name,
  path,
  typedName,
}: {
  readonly name: string
  readonly path: string | null
  readonly typedName: string | null
}) {
  if (path !== null) {
    return (
      <SignaturePicture
        path={path}
        label={`Unterschrift von ${name}`}
        className="block aspect-[5/2] w-full"
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={`Unterschrift von ${name}, ${signatureWayLabel.name}`}
      className="flex aspect-[5/2] w-full items-center justify-center px-1 text-center"
    >
      <span className="text-[15px] leading-tight font-semibold italic [overflow-wrap:anywhere]">
        {typedName ?? name}
      </span>
    </div>
  )
}

/** The line under the moment of a signature that was typed, or nothing for a drawing. */
export function typedWay(typedName: string | null): string {
  return typedName === null ? '' : `, ${signatureWayLabel.name}`
}
