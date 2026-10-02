import type { ServerApplication } from '@opengewerk/platform-server'

/**
 * What this application calls itself, where the foundation has to say a name
 * (ADR 0001, point 11).
 *
 * The sentences an instance writes into its log, the port it listens on and
 * the variables it reads are the application's own; the checks around them
 * are the foundation's and the same for every application of the
 * organisation. The port and the variables differ from those of the
 * Handwerkersoftware on purpose: both run side by side on one server, and a
 * script that hands a password to one must not reach the other.
 */
export const application: ServerApplication = {
  name: 'OpenGewerk Haustechnik',
  port: 23800,
  versionVariable: 'HAUSTECHNIK_VERSION',
  passwordVariable: 'HAUSTECHNIK_PASSWORD',
  exampleOrigin: 'https://haustechnik.example.de',
  exampleDatabase: 'haustechnik',
}
