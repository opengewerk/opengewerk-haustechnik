import { resetSecondFactorCommand } from '@opengewerk/platform-server'

import { application } from './configuration.js'

// Takes every second factor of an account away, from the command line (#591):
// the way back for whoever has lost the only one and works for more than one
// operator, or belongs to the administration of the instance, which whoever
// leads an operator may not do for them, and for the lead of the only
// operator there is. The app and every passkey go, every session ends, the
// password stays; every operator the account works for has it in its log.
//
//     docker compose -f docker/compose.yaml exec app node dist/reset-second-factor.js <email>
//
// The command is the foundation's (ADR 0010 in the repository opengewerk);
// what this application adds is its name.
await resetSecondFactorCommand(application)
