import { appointOperatorCommand } from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'

// Adds an account to the Verwaltung der Instanz from the command line.
//
// The account of the first run setup belongs to it from the start. This is the
// way back when every account of the Verwaltung has lost its second factor, or
// when it should get another one without the area of the instance. The account
// must exist already; its password stays as it is.
//
//     docker compose -f docker/compose.yaml exec app \
//       node dist/appoint-operator.js <email>
//
// The command is the foundation's (ADR 0010 in the repository opengewerk);
// what this application adds is its name and its words.
await appointOperatorCommand(application, access)
