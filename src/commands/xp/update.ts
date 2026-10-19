import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {buildRule, formatRoute, validateRoutingFlags} from '../../utils/routing'
import {
  ExperimentEntry,
  findExperimentByBranch,
} from '../../types/experiment'
import {readExperimentsConfig, writeExperimentsConfig} from '../../utils/experiments-config'

export default class Update extends Command {
  static description = 'Replace an experiment\'s routing rule (routing flags that are not given are cleared)'

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
      description: 'Path-based routing',
    }),
    query: flags.string({
      char: 'q',
      description: 'Query parameter routing (format: key=value)',
    }),
    header: flags.string({
      char: 'H',
      description: 'Header-based routing (format: key=value)',
    }),
    methods: flags.string({
      char: 'm',
      description: 'HTTP methods to route, comma-separated (e.g. GET,POST)',
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
      const existingExperiment = findExperimentByBranch(experimentsConfig, branch)
      if (!existingExperiment) {
        throw new Error(`No experiment found for branch "${branch}" on app "${parentApp}"`)
      }

      // Step 4: Update experiment configuration
      const updatedExperiment = this.buildUpdatedExperiment(existingExperiment, flags)

      // Step 5: Replace in config
      const index = experimentsConfig.experiments.findIndex(
        exp => exp.branch === branch
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

    // Routing flags replace the rule; any that aren't given are cleared.
    // Without routing flags the existing rules are kept.
    const hasRoutingConfig = flags.weight !== undefined || flags.path || flags.query || flags.header || flags.methods || flags.traffic !== undefined
    const rules = hasRoutingConfig ? [buildRule(flags)] : existingExperiment.rules

    return {
      ...existingExperiment,
      rules,
    }
  }

}
