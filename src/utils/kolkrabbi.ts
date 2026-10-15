import {APIClient} from '@heroku-cli/command'

/**
 * Heroku's GitHub integration API ("kolkrabbi"). It is not publicly documented
 * and can change without notice.
 */
export function kolkrabbiUrl(): string {
  return process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'
}

export interface GitHubConnection {
  repo?: string
  id?: number
  branch?: string
}

/** The GitHub repository (and deploy branch) connected to an app. Needs the app UUID. */
export async function getGitHubConnection(heroku: APIClient, appId: string): Promise<GitHubConnection> {
  const url = kolkrabbiUrl()
  const {body} = await heroku.get<GitHubConnection>(`${url}/apps/${appId}/github`, {
    hostname: new URL(url).hostname,
  })
  return body
}
