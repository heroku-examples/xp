import {APIClient} from '@heroku-cli/command'

export interface HerokuApp {
  id: string
  name: string
  web_url: string
}

export interface PipelineCoupling {
  pipeline?: {id: string}
}

export interface ReviewApp {
  branch: string
  status: string
  created_at: string
  app: {id: string; name?: string} | null
}

interface BuildpackInstallation {
  buildpack: {url: string}
}

interface Release {
  status: string
  version: number
  slug?: unknown
  description?: string
}

/** Strips IDs and URLs from an error message before it is shown. */
export function sanitizeErrorMessage(error: any): string {
  const message = error.message || String(error)
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[ID]')
    .replace(/app-\d+/gi, '[APP]')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
}

export async function getApp(heroku: APIClient, appName: string): Promise<HerokuApp> {
  try {
    const {body} = await heroku.get<HerokuApp>(`/apps/${appName}`)
    return body
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw new Error(`App "${appName}" not found`)
    }
    throw new Error(`Failed to fetch app details: ${sanitizeErrorMessage(error)}`)
  }
}

/** The app's pipeline coupling, or null if it is not in a pipeline. */
export async function getPipelineCoupling(heroku: APIClient, appId: string): Promise<PipelineCoupling | null> {
  try {
    const {body} = await heroku.get<PipelineCoupling>(`/apps/${appId}/pipeline-couplings`)
    return body
  } catch (error: any) {
    if (error.statusCode === 404) return null
    throw error
  }
}

export async function getPipelineName(heroku: APIClient, pipelineId: string): Promise<string> {
  const {body} = await heroku.get<{name: string}>(`/pipelines/${pipelineId}`)
  return body.name
}

/** The newest review app for the branch that is not errored, failed or deleted. */
export async function findReviewApp(heroku: APIClient, pipelineId: string, branch: string): Promise<ReviewApp | null> {
  const {body} = await heroku.get<ReviewApp[]>(`/pipelines/${pipelineId}/review-apps`, {
    headers: {Accept: 'application/vnd.heroku+json; version=3'},
  })

  const matching = body
    .filter(app => app.branch === branch && !['errored', 'failed', 'deleted'].includes(app.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return matching[0] ?? null
}

/** Cloud Native Buildpack apps cannot have buildpacks set through the API. */
export function isCnbError(error: any): boolean {
  return sanitizeErrorMessage(error).includes('Cloud Native Buildpacks')
}

/** Appends a buildpack to the app unless one matching `isInstalled` is already there. */
export async function ensureBuildpack(
  heroku: APIClient,
  appName: string,
  url: string,
  isInstalled: (installedUrl: string) => boolean,
): Promise<void> {
  const {body: installed} = await heroku.get<BuildpackInstallation[]>(`/apps/${appName}/buildpack-installations`)
  if (installed.some(bp => isInstalled(bp.buildpack.url))) return

  await heroku.put(`/apps/${appName}/buildpack-installations`, {
    body: {
      updates: [
        ...installed.map((bp, ordinal) => ({buildpack: bp.buildpack.url, ordinal})),
        {buildpack: url, ordinal: installed.length},
      ],
    },
  })
}

/**
 * Polls until the app's latest release has succeeded. Returns false if it has
 * not by the timeout; throws if the build failed.
 */
export async function waitForRelease(heroku: APIClient, appName: string): Promise<boolean> {
  const maxAttempts = 60 // 5 minutes
  const pollInterval = 5000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const {body: releases} = await heroku.get<Release[]>(`/apps/${appName}/releases`, {
        headers: {Range: 'version ..; order=desc,max=1'},
      })
      const latest = releases?.[0]

      if (latest?.status === 'succeeded' && (latest.version > 1 || latest.slug)) {
        return true
      }
      if (latest?.status === 'failed') {
        throw new Error(`Build failed: ${latest.description || 'Unknown error'}`)
      }
    } catch (error: any) {
      if (error.message?.includes('Build failed')) throw error
      // Otherwise keep polling.
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  return false
}
