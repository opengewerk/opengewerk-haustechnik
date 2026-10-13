import { secretStore } from '@opengewerk/platform-server'

import { secrets } from '../database/schema/index.js'

/**
 * The sealed credentials of the operators of this application. How they are
 * sealed, kept and opened is the foundation's (`secretStore`, ADR 0010 in the
 * repository opengewerk); this binds it to the table with the purposes of
 * this application, and is the one place outside the schema that names the
 * table. So far there is one purpose, the password of an operator's mail
 * server (#126).
 */
export const secretsOfOperators = secretStore(secrets)
