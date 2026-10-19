import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  ExperimentsConfig,
} from '../../types/experiment'
import {readExperimentsConfig} from '../../utils/experiments-config'
import {formatRoute} from '../../utils/routing'

export default class List extends Command {
  static description = 'List all experiments configured in HEROKU_XP'

  static examples = [
    `$ heroku xp:list --app my-app-staging`,
    `$ heroku xp:list -a my-app-staging`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }

  async run() {
    const {flags} = await this.parse(List)
    const appName = flags.app!

    try {
      // Fetch HEROKU_XP config var
      cli.action.start('Fetching experiment configuration')
      let experimentsConfig: ExperimentsConfig
      try {
        experimentsConfig = await readExperimentsConfig(this.heroku, appName)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Check if there are any experiments
      if (experimentsConfig.experiments.length === 0) {
        this.log('')
        this.log('No experiments configured. Run `heroku xp:create` to create one.')
        this.log('')
        return
      }

      // Display experiments in a table
      this.log('')
      this.log(`Experiments for ${appName}:`)
      this.log('')

      // Format the data for display
      const tableData = experimentsConfig.experiments.map(exp => {
        // Check if experiment is in mirror mode
        const isMirror = exp.rules && exp.rules.length > 0 && exp.rules[0].traffic === 'mirror'
        const mode = isMirror ? 'mirror' : 'live'
        return {
          active: exp.active !== false ? `✓ ${mode}` : '✗',
          branch: exp.branch,
          route: formatRoute(exp),
        }
      })

      // Display table using cli-ux
      cli.table(tableData, {
        active: {
          header: 'Traffic',
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

      // Show summary
      this.log('')
      this.log(`Total experiments: ${experimentsConfig.experiments.length}`)
      this.log('')

    } catch (error: any) {
      cli.action.stop('✗')
      this.error(`Failed to list experiments: ${error.message}`)
    }
  }
}
