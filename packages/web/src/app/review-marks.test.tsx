import { date, today } from '@opengewerk/platform-web/format'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  Acceptance,
  CheckedOn,
  checkedLongAgoWords,
  reviewLine,
  ReviewMarks,
  unacceptedWords,
} from './review-marks.js'
import { acceptedReview, neglectedReview, unacceptedReview } from './test-catalogue.js'

/**
 * What a reader is told about an entry of the catalogue, wherever one is
 * shown (#90, section 5 of the concept).
 */

const said = (ui: React.ReactNode) => render(ui).container.textContent

describe('the marks of an entry of the catalogue', () => {
  it('say nothing about an entry accepted and checked within the year', () => {
    expect(said(<ReviewMarks review={acceptedReview} />)).toBe('')
  })

  it('say that nobody has accepted an entry', () => {
    expect(said(<ReviewMarks review={unacceptedReview} />)).toBe(unacceptedWords)
  })

  it('say both of an entry nobody accepted whose check lies more than a year back', () => {
    expect(said(<ReviewMarks review={neglectedReview} />)).toBe(
      `${unacceptedWords}${checkedLongAgoWords}`,
    )
  })

  it('say that the check is long ago of an entry somebody accepted then', () => {
    expect(
      said(<ReviewMarks review={{ checkedOn: '2020-01-01', accepted: acceptedReview.accepted }} />),
    ).toBe(checkedLongAgoWords)
  })
})

describe('the two columns of the review in a list of entries', () => {
  it('say of every entry whether it is accepted, never nothing', () => {
    expect(said(<Acceptance review={acceptedReview} />)).toBe('Abgenommen')
    expect(said(<Acceptance review={unacceptedReview} />)).toBe(unacceptedWords)
  })

  it('name the day of the last check, and in words that it is more than a year back', () => {
    expect(said(<CheckedOn review={acceptedReview} />)).toBe(date(today()))
    expect(said(<CheckedOn review={neglectedReview} />)).toBe(
      '01.01.2020, seit über einem Jahr nicht geprüft',
    )
  })

  it('stand in one line in the box of a row on a phone', () => {
    expect(reviewLine(acceptedReview)).toBe(`Abgenommen · geprüft am ${date(today())}`)
    expect(reviewLine(neglectedReview)).toBe(
      'Nicht abgenommen · seit über einem Jahr nicht geprüft (01.01.2020)',
    )
  })
})
