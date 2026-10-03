import { addTenantCommand } from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'

// Creates a further Betreiber on the instance from the command line, with its
// Leitung. The Verwaltung der Instanz does the same in the area of the
// instance, where the Leitung gets a link; here it is put in at once, with an
// account when there is none yet, as `add-staff` does it.
//
// The password of a new account is asked for on the terminal and not shown,
// or comes from `HAUSTECHNIK_PASSWORD`, never from an argument.
//
//     docker compose -f docker/compose.yaml exec app \
//       node dist/add-tenant.js "<name des betreibers>" <email> "<name der leitung>"
//
// The command is the foundation's (ADR 0010 in the repository opengewerk);
// what this application adds is its name, its roles and its words.
await addTenantCommand(application, access)
