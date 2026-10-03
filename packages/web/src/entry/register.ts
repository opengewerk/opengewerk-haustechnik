import { offerUpdate } from '@opengewerk/platform-web/shell'
import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the service worker and, when a new build arrives, offers it.
 *
 * The one place in the package that imports the virtual module the plugin
 * provides. It exists only while vite is running, so everything else has to
 * stay clear of it or no test in this package would resolve its imports.
 *
 * Offered rather than swapped: replacing the code under somebody who is
 * filling in a form in a plant room loses what they typed, and on the entry
 * for the work on site that is the normal situation rather than an edge case.
 */
export function startServiceWorker(): void {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      offerUpdate(() => {
        void update(true)
      })
    },
  })
}
