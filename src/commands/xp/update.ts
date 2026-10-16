import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {formatRoute, parseMethods, validateRoutingFlags} from '../../utils/routing'
import {
  ExperimentEntry,
  findExperimentByKey,
} from '../../types/experiment'
import {readExperimentsConfig, writeExperimentsConfig} from '../../utils/experiments-config'

export default class Update extends Command {
  static description = 'Update experiment routing configuration (HEROKU_XP only)'

  static examples = [
    `$ heroku xp:update --app my-app-staging --branch feature-xyz --weight 20`,
    `$ heroku xp:update -a my-app-staging -b new-ui --path /api/v2`,
    `$ heroku xp:update -a my-app-staging -b test --weight 0`,
    `$ heroku xp:update -a my-app-staging -b new-ui --methods GET,POST`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name of the experiment to update',
      required: true,
    }),
    weight: flags.integer({
      char: 'w',
      description: 'Traffic weight percentage (0-100)',
    }),
    path: flags.string({
      char: 'p',
      description: 'Path-based routing (can specify multiple)',
      multiple: true,
    }),
    query: flags.string({
      char: 'q',
      description: 'Query parameter routing (format: key=value)',
      multiple: true,
    }),
    header: flags.string({
      char: 'H',
      description: 'Header-based routing (format: key=value)',
      multiple: true,
    }),
    methods: flags.string({
      char: 'm',
      description: 'HTTP methods to route (comma-separated or repeated, e.g. GET,POST)',
      multiple: true,
    }),
    traffic: flags.string({
      char: 't',
      description: 'How traffic reaches the experiment: mirror (staging still responds) or live (the experiment responds)',
      options: ['mirror', 'live'],
    }),
  }

  async run() {
    const {flags} = await this.parse(Update)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      cli.action.start('Updating experiment')

      // Step 1: Validate arguments
      validateRoutingFlags(branch, flags)

      // Step 2: Read HEROKU_XP config var
      const experimentsConfig = await readExperimentsConfig(this.heroku, parentApp, {required: true})

      // Step 3: Find experiment by branch
      const existingExperiment = findExperimentByKey(experimentsConfig, parentApp, branch)
      if (!existingExperiment) {
        throw new Error(`No experiment found for branch "${branch}" on app "${parentApp}"`)
      }

      // Step 4: Update experiment configuration
      const updatedExperiment = this.buildUpdatedExperiment(existingExperiment, flags)

      // Step 5: Replace in config
      const index = experimentsConfig.experiments.findIndex(
        exp => exp.parentApp === parentApp && exp.branch === branch
      )
      if (index !== -1) {
        experimentsConfig.experiments[index] = updatedExperiment
      }

      // Step 6: Update HEROKU_XP config var
      await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)

      cli.action.stop('')

      // Display updated experiment in table format
      this.log('')
      this.log('Updated experiment:')
      this.log('')

      // Check if experiment is in mirror mode
      const isMirror = updatedExperiment.rules && updatedExperiment.rules.length > 0 && updatedExperiment.rules[0].traffic === 'mirror'
      const mode = isMirror ? 'mirror' : 'live'
      const tableData = [{
        active: updatedExperiment.active !== false ? `✓ ${mode}` : '✗',
        branch: updatedExperiment.branch,
        route: formatRoute(updatedExperiment),
      }]

      cli.table(tableData, {
        active: {
          header: 'Active',
          minWidth: 8,
        },
        branch: {
          header: 'Branch',
          minWidth: 15,
        },
        route: {
          header: 'Route',
          minWidth: 30,
        },
      })

      this.log('')
      this.log(`heroku xp:watch --app ${parentApp}`)
      this.log('')

    } catch (error: any) {
      cli.action.stop('')
      this.error(`Failed to update experiment: ${error.message}`)
    }
  }

  private buildUpdatedExperiment(
    existingExperiment: ExperimentEntry,
    flags: any
  ): ExperimentEntry {

    // Build rules array
    const rules: any[] = []

    // Create rule if any routing parameters exist
    const hasRoutingConfig = flags.weight !== undefined || flags.path || flags.query || flags.header || flags.methods || flags.traffic !== undefined

    if (hasRoutingConfig) {
      const rule: any = {}

      // Keep the existing traffic setting or default to mirror
      rule.traffic = flags.traffic ?? existingExperiment.rules?.[0]?.traffic ?? 'mirror'

      if (flags.weight !== undefined) {
        rule.weight = flags.weight
      } else if (existingExperiment.rules?.[0]?.weight !== undefined) {
        // Keep existing weight
        rule.weight = existingExperiment.rules[0].weight
      }

      // Convert path array to comma-separated string
      if (flags.path && Array.isArray(flags.path)) {
        rule.path = flags.path.join(',')
      } else if (existingExperiment.rules?.[0]?.path) {
        // Keep existing path
        rule.path = existingExperiment.rules[0].path
      }

      // Convert query array to string format "key: value"
      if (flags.query && Array.isArray(flags.query)) {
        const [key, value] = flags.query[0].split('=')
        rule.query = `${key}: ${value}`
      } else if (existingExperiment.rules?.[0]?.query) {
        // Keep existing query
        rule.query = existingExperiment.rules[0].query
      }

      // Convert header array to string format "key: value"
      if (flags.header && Array.isArray(flags.header)) {
        const [key, value] = flags.header[0].split('=')
        rule.header = `${key}: ${value}`
      } else if (existingExperiment.rules?.[0]?.header) {
        // Keep existing header
        rule.header = existingExperiment.rules[0].header
      }

      rule.method = parseMethods(flags.methods) ?? existingExperiment.rules?.[0]?.method ?? 'GET'

      rules.push(rule)
    } else {
      // No routing config provided, keep existing rules
      if (existingExperiment.rules && existingExperiment.rules.length > 0) {
        rules.push(...existingExperiment.rules)
      }
    }

    return {
      ...existingExperiment,
      rules,
    }
  }

}
