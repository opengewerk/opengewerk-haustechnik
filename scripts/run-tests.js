// @ts-check
import { spawnSync } from 'node:child_process'

// Runs the tests of every package, the ones of the foundation included.
//
// Some of them need a database and empty it before they start. Where it is,
// they read from DATABASE_URL, and the packages of the foundation fall back
// to the test database of the repository they come from. Left to that, the
// tests here would run against the database of another repository, if one
// happens to be up on this machine, and take the schema away from whatever is
// running there. So the address of this application's own test database is
// set here, once, for every package, unless the caller has set another.
//
//   docker compose -f docker/compose.test.yaml up -d
//   pnpm run test
//
// The name of the database has to end in _test, the tests refuse anything
// else.
const ownTestDatabase = 'postgres://haustechnik:haustechnik@127.0.0.1:5434/haustechnik_test'

process.env['DATABASE_URL'] ??= ownTestDatabase

// Through the shell, because the command pnpm puts on the path is a script of
// its own on Windows. What follows `pnpm run test --` is handed on, a filter
// for instance.
const forwarded = process.argv.slice(2)
const result = spawnSync(['turbo', 'run', 'test', ...forwarded].join(' '), {
  stdio: 'inherit',
  shell: true,
})

process.exit(result.status ?? 1)
