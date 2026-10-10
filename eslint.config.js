// @ts-check
import {
  computesOnly,
  configuration,
  everywhere,
  formatting,
  generated,
  layersAbove,
  mayNotImport,
  runsInBrowser,
  runsInNode,
} from './upstream/opengewerk/eslint.shared.js'

// The rules themselves come from the foundation, where every application of
// the organisation takes them from (ADR 0010 in the repository opengewerk).
// This file says where the packages of this repository are and what they are
// called.

// What the domain package may not reach up into. Server and interface arrive
// with their first content; their names are settled (ADR 0001), and a boundary
// that is only drawn once somebody has crossed it is drawn too late.
const above = layersAbove({
  packages: [
    '@opengewerk/haustechnik-catalogue',
    '@opengewerk/haustechnik-server',
    '@opengewerk/haustechnik-web',
  ],
  folders: ['catalogue', 'server', 'web'],
})

// The submodule holds the whole repository of the Handwerkersoftware, and only
// its foundation is a member of this workspace. An import of anything else in
// there fails as a missing module; this is the rule that says why.
const besideTheFoundation = [
  {
    group: [
      '@opengewerk/domain',
      '@opengewerk/domain/*',
      '@opengewerk/server',
      '@opengewerk/server/*',
      '@opengewerk/web',
      '@opengewerk/web/*',
      '@opengewerk/gewerk-*',
      '@opengewerk/gewerk-*/*',
    ],
    message:
      'This application stands on the foundation, not on the Handwerkersoftware (ADR 0001). What both need belongs in a package of the foundation.',
  },
  {
    group: ['**/upstream/**'],
    message:
      'The foundation is imported by the name of its package, never by a path into the submodule.',
  },
]

export default configuration(
  generated,

  // Linted in the repository it belongs to, and here by its own configuration
  // whenever a package of the foundation runs its lint as a member of this
  // workspace.
  { ignores: ['upstream/**'] },

  ...everywhere,

  // The domain package computes; it does not talk to the outside world.
  computesOnly(['packages/domain/**/*.ts'], [...above, ...besideTheFoundation]),

  // Every other package of the application: nothing reaches past the
  // foundation. The domain package is left out because the block above
  // already carries the whole list, and a later block would replace it.
  {
    ...mayNotImport(['packages/**/*.{ts,tsx}'], besideTheFoundation),
    ignores: ['packages/domain/**'],
  },

  // What runs in production on the server never reaches the preview, a test
  // helper or the parts of better-auth that only a test sets up (#80). Only
  // the preview, the tests and the helpers themselves may: excluding them from
  // the image is no fence, a line in a source file is.
  {
    ...mayNotImport(
      ['packages/server/src/**/*.ts'],
      [
        ...besideTheFoundation,
        {
          group: ['**/preview/**', '**/test-*', 'better-auth/node'],
          message:
            'Production code of the server reaches neither the preview nor a test helper; both stay out of the image.',
        },
      ],
    ),
    ignores: [
      'packages/server/src/**/*.test.ts',
      'packages/server/src/preview/**',
      'packages/server/src/**/test-*.ts',
    ],
  },

  // The server runs in Node and nowhere else, the interface in a browser. The
  // loader of the catalogue runs in Node as well, at build time.
  runsInNode(['packages/server/**/*.ts', 'packages/catalogue/**/*.ts']),
  runsInBrowser(['packages/web/**/*.{ts,tsx}']),

  // The shared configuration at the root, the scripts beside it and the small
  // scripts a package keeps beside its source run in Node. The build tooling
  // is the one place where reading the environment and writing to a console
  // is the job.
  runsInNode([
    '*.js',
    '*.config.js',
    '*.config.ts',
    'scripts/**/*.js',
    'packages/*/scripts/**/*.js',
  ]),

  formatting,
)
