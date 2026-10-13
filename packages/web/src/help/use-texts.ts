import { useQuery } from '@tanstack/react-query'

/**
 * The texts of a folder of the help, loaded when a screen asks for them
 * (#131). Each is a module of the build, so it comes from the cache of the
 * service worker where there is no network, and it does not change while a
 * page is open. `networkMode` says so to the query, which would otherwise
 * wait for a network that is not needed.
 */
const loaders = {
  guides: () => import('./guide-texts.js').then((module) => module.guideTexts),
  site: () => import('./site-texts.js').then((module) => module.siteTexts),
  manual: () => import('./manual-texts.js').then((module) => module.manualTexts),
} as const

export type HelpFolder = keyof typeof loaders

/** The texts by their key, or nothing while they are on their way. */
export function useHelpTexts(folder: HelpFolder): ReadonlyMap<string, string> | undefined {
  return useQuery({
    queryKey: ['help', 'texts', folder],
    queryFn: loaders[folder],
    staleTime: Infinity,
    networkMode: 'always',
    retry: false,
  }).data
}
