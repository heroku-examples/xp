import {Command, flags as flagTypes} from '@heroku-cli/command'
import {spawnSync} from 'child_process'
import {cli} from 'cli-ux'
import * as crypto from 'crypto'
import {SimplifiedExperimentEntry, SimplifiedRule, findExperimentByKey} from '../../types/experiment'
import {readExperimentsConfig, writeExperimentsConfig} from '../../utils/experiments-config'
import {
  ensureBuildpack,
  findReviewApp,
  getApp,
  getPipelineCoupling,
  getPipelineName,
  isCnbError,
  sanitizeErrorMessage,
  waitForRelease,
} from '../../utils/heroku-api'
import {getGitHubConnection} from '../../utils/kolkrabbi'
import {formatRoute, validateRoutingFlags} from '../../utils/routing'

const XP_BUILDPACK_URL = 'https://github.com/heroku-examples/xp/releases/latest/download/xp-buildpack.tgz'

export default class Create extends Command {
  static description = 'Route traffic to a branch\'s review app'

  static examples = [
    `$ heroku xp:create --app my-app-staging --branch feature-xyz`,
    `$ heroku xp:create --app my-app-staging --branch new-ui --weight 10`,
    `$ heroku xp:create --app my-app-staging --branch api-v2 --path /api/v2`,
    `$ heroku xp:create -a xp-demo-staging -b 1-green --weight 50 --path '/*' --traffic live`,
  ]

  static flags: any = {
    app: flagTypes.app({required: true}),
    remote: flagTypes.remote(),
    branch: flagTypes.string({
      char: 'b',
      description: 'GitHub branch name for the experiment',
      required: true,
    }),
    weight: flagTypes.integer({
      char: 'w',
      description: 'Traffic weight percentage (0-100)',
    }),
    path: flagTypes.string({
      char: 'p',
      description: 'Path-based routing (can specify multiple)',
      multiple: true,
    }),
    query: flagTypes.string({
      char: 'q',
      description: 'Query parameter routing (format: key=value)',
      multiple: true,
    }),
    header: flagTypes.string({
      char: 'H',
      description: 'Header-based routing (format: key=value)',
      multiple: true,
    }),
    'create-review-app': flagTypes.boolean({
      description: 'Create the branch\'s review app without asking if it does not exist',
    }),
    traffic: flagTypes.string({
      char: 't',
      description: 'How traffic reaches the experiment: mirror (staging still responds) or live (the experiment responds)',
      options: ['mirror', 'live'],
    }),
  }

  async run() {
    const {flags} = await this.parse(Create)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      let {weight, traffic} = flags
      const hasRoutingConfig = weight !== undefined || flags.path || flags.query || flags.header || traffic !== undefined

      if (!hasRoutingConfig) {
        this.log('')
        this.log('Default experiment rules:')
        this.log('  method: GET')
        this.log('  weight: 10')
        this.log('  traffic: mirror')
        this.log('')

        const confirmed = await cli.confirm('Create experiment with these defaults? (y/n)')
        if (!confirmed) {
          this.log('Cancelled.')
          return
        }

        weight = 10
        traffic = 'mirror'
      }

      cli.action.start('Creating experiment')

      validateRoutingFlags(branch, flags)

      const parentAppData = await getApp(this.heroku, parentApp)
      await this.ensureXpBuildpack(parentApp)

      const github = await getGitHubConnection(this.heroku, parentAppData.id).catch((error: any) => {
        throw new Error(`Failed to verify GitHub connection: ${sanitizeErrorMessage(error)}. Ensure the app is connected to a GitHub repository.`)
      })
      if (!github.repo) {
        throw new Error('No GitHub repository connected')
      }

      const experimentsConfig = await readExperimentsConfig(this.heroku, parentApp)
      experimentsConfig.metrics_user ??= crypto.randomBytes(8).toString('hex')
      experimentsConfig.metrics_secret ??= crypto.randomBytes(24).toString('hex')

      // An experiment is keyed by parent app and branch.
      const existingExperiment = findExperimentByKey(experimentsConfig, parentApp, branch)
      const isUpdate = Boolean(existingExperiment)

      // An update keeps its review app.
      const experimentAppName = existingExperiment?.appName ??
        await this.resolveReviewApp(parentApp, parentAppData.id, branch, flags['create-review-app'])
      const experimentApp = await getApp(this.heroku, experimentAppName)

      if (!isUpdate) {
        const ready = await waitForRelease(this.heroku, experimentAppName)
        if (!ready) {
          this.warn(`App may still be booting. Check status with: heroku ps --app ${experimentAppName}`)
        }
      }

      const now = new Date().toISOString()
      const newExperiment: SimplifiedExperimentEntry = {
        appName: experimentAppName,
        appID: experimentApp.id,
        parentApp,
        branch,
        version: existingExperiment ? existingExperiment.version + 1 : 1,
        repo: github.repo,
        url: experimentApp.web_url || '',
        rules: [this.buildRule({...flags, weight, traffic})],
        createdAt: existingExperiment?.createdAt || now,
        updatedAt: now,
      }

      if (existingExperiment) {
        const index = experimentsConfig.experiments.indexOf(existingExperiment)
        experimentsConfig.experiments[index] = newExperiment
      } else {
        experimentsConfig.experiments.push(newExperiment)
      }

      await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)

      cli.action.stop('')

      this.log('')
      this.log(`${isUpdate ? 'Updated' : 'Created'} experiment:`)
      this.log('')

      cli.table([{
        active: `✓ ${newExperiment.rules[0].traffic}`,
        branch: newExperiment.branch,
        route: formatRoute(newExperiment),
      }], {
        active: {header: 'Active', minWidth: 15},
        branch: {header: 'Branch', minWidth: 15},
        route: {header: 'Route', minWidth: 20},
      })

      this.log('')
      this.log(`heroku xp:watch --app ${parentApp}`)
      this.log('')
    } catch (error: any) {
      cli.action.stop('')
      this.error(`Failed to create experiment: ${sanitizeErrorMessage(error)}`)
    }
  }

  private buildRule(flags: {
    weight?: number
    traffic?: string
    path?: string[]
    query?: string[]
    header?: string[]
  }): SimplifiedRule {
    // "key=value" becomes "key: value"; only the first of several is used.
    const keyValue = (kind: string, raw: string) => {
      const [key, ...rest] = raw.split('=')
      const value = rest.join('=')
      for (const part of [key, value]) {
        if (/[\r\n]/.test(part)) {
          throw new Error(`Invalid ${kind}: contains newline characters`)
        }
      }

      return `${key}: ${value}`
    }

    const rule: SimplifiedRule = {
      traffic: flags.traffic === 'live' ? 'live' : 'mirror',
      method: 'GET',
    }
    if (flags.weight !== undefined) rule.weight = flags.weight
    if (flags.path) rule.path = flags.path.join(',')
    if (flags.query) rule.query = keyValue('query', flags.query[0])
    if (flags.header) rule.header = keyValue('header', flags.header[0])

    return rule
  }

  private async ensureXpBuildpack(appName: string): Promise<void> {
    try {
      await ensureBuildpack(
        this.heroku,
        appName,
        XP_BUILDPACK_URL,
        url => url.includes('heroku-examples/xp') || url.includes('dyno-proxy-buildpack'),
      )
    } catch (error: any) {
      if (isCnbError(error)) {
        // CNB apps take their buildpacks from project.toml.
        this.warn([
          `${appName} uses Cloud Native Buildpacks, so XP will not function until the buildpack is added to its project.toml:`,
          '',
          '  # project.toml',
          '  [[io.buildpacks.group]]',
          '  uri = "docker://ghcr.io/heroku-examples/xp"',
          '',
          'Redeploy after modifying project.toml.',
        ].join('\n'))
        return
      }

      throw new Error(`Failed to configure buildpacks: ${sanitizeErrorMessage(error)}`)
    }
  }

  // The name of the branch's review app. If it doesn't exist, creates it (autoCreate) or offers to.
  private async resolveReviewApp(parentApp: string, parentAppId: string, branch: string, autoCreate: boolean): Promise<string> {
    const pipelineId = (await getPipelineCoupling(this.heroku, parentAppId))?.pipeline?.id
    if (!pipelineId) {
      throw new Error(`${parentApp} is not in a pipeline. Add it to a pipeline with review apps enabled.`)
    }

    let reviewApp = await findReviewApp(this.heroku, pipelineId, branch)
    if (!reviewApp) {
      cli.action.stop('')
      this.log(`No review app found for branch ${branch}.`)
      const pipelineName = await getPipelineName(this.heroku, pipelineId)
      const command = ['reviewapps:create', '--pipeline', pipelineName, '--branch', branch, '--wait']
      const confirmed = autoCreate || await cli.confirm(`Run \`heroku ${command.join(' ')}\`? (y/n)`)
      if (!confirmed) {
        throw new Error(`No review app for branch ${branch}`)
      }

      const {status} = spawnSync('heroku', command, {stdio: 'inherit'})
      if (status !== 0) {
        throw new Error('heroku reviewapps:create failed')
      }

      cli.action.start('Waiting for review app')
    }

    // A new review app has no app until it is provisioned.
    const maxAttempts = 60 // 5 minutes
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      reviewApp ??= await findReviewApp(this.heroku, pipelineId, branch)
      const name = reviewApp?.app?.name || reviewApp?.app?.id
      if (name) return name

      reviewApp = null
      await new Promise(resolve => setTimeout(resolve, 5000))
    }

    throw new Error(`Timed out waiting for the review app for branch ${branch} to be provisioned`)
  }
}
