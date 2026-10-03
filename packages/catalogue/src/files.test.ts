import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MissingFolderError, readPackageFiles } from './files.js'

const folders: string[] = []

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'pakete-'))
  folders.push(made)
  return made
}

afterEach(() => {
  for (const made of folders.splice(0)) {
    rmSync(made, { recursive: true, force: true })
  }
})

describe('reading the folder of the packages', () => {
  it('names every file by its path in the folder, with slashes on every system', () => {
    const root = folder()
    mkdirSync(join(root, 'probe', 'pflichten'), { recursive: true })
    writeFileSync(join(root, 'README.md'), 'Pakete')
    writeFileSync(join(root, 'probe', 'pflichten', 'elevator_main_test.v1.json'), '{}')

    expect([...readPackageFiles(root).keys()].sort()).toEqual([
      'README.md',
      'probe/pflichten/elevator_main_test.v1.json',
    ])
  })

  it('leaves out what an operating system leaves behind', () => {
    const root = folder()
    mkdirSync(join(root, 'probe', '.cache'), { recursive: true })
    writeFileSync(join(root, '.DS_Store'), '')
    writeFileSync(join(root, 'probe', '.cache', 'manifest.json'), '{}')
    writeFileSync(join(root, 'probe', 'manifest.json'), '{}')

    expect([...readPackageFiles(root).keys()]).toEqual(['probe/manifest.json'])
  })

  it('refuses a folder that is not there instead of reading an empty catalogue', () => {
    expect(() => readPackageFiles(join(folder(), 'pakete'))).toThrow(MissingFolderError)
  })
})
