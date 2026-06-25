import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  createEmptySimplifiedConfig,
} from '../../types/experiment'

export default class List extends Command {
  static description = 'List all experiments configured in HEROKU_XP'

  static examples = [
    `$ heroku xp:list --app xp-demo-staging`,
    `$ heroku xp:list -a prod-app`,
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
      let experimentsConfig: SimplifiedExperimentsConfig
      try {
        experimentsConfig = await this.getExperimentsConfig(appName)
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
        return {
          appName: exp.appName,
          branch: exp.branch,
          parentApp: exp.parentApp,
          version: `v${exp.version}`,
          weight: this.formatWeight(exp),
          path: this.formatPath(exp),
          createdAt: this.formatDate(exp.createdAt),
        }
      })

      // Display table using cli-ux
      cli.table(tableData, {
        appName: {
          header: 'App Name',
          minWidth: 20,
        },
        branch: {
          header: 'Branch',
          minWidth: 15,
        },
        parentApp: {
          header: 'Parent App',
          minWidth: 15,
        },
        version: {
          header: 'Version',
          minWidth: 8,
        },
        weight: {
          header: 'Weight %',
          minWidth: 10,
        },
        path: {
          header: 'Path',
          minWidth: 15,
        },
        createdAt: {
          header: 'Created',
          minWidth: 12,
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

  private async getExperimentsConfig(appName: string): Promise<SimplifiedExperimentsConfig> {
    try {
      const {body: configVars} = await this.heroku.get(`/apps/${appName}/config-vars`)
      const configVarsData = configVars as {HEROKU_XP?: string}

      if (configVarsData.HEROKU_XP) {
        try {
          const config: AnyExperimentsConfig = parseExperimentsConfig(configVarsData.HEROKU_XP)

          // Migrate v1 to v2 if needed
          if (!isSimplifiedConfig(config)) {
            return migrateToSimplified(config)
          }

          return config
        } catch (error: any) {
          throw new Error(`Failed to parse HEROKU_XP config: ${error.message}`)
        }
      }

      // Return empty v2 config if HEROKU_XP doesn't exist
      return createEmptySimplifiedConfig()
    } catch (error: any) {
      throw new Error(`Failed to read experiment configuration: ${error.message}`)
    }
  }

  private formatWeight(exp: SimplifiedExperimentEntry): string {
    if (exp.rules && exp.rules.length > 0 && exp.rules[0].weight !== undefined) {
      return `${exp.rules[0].weight}%`
    }
    return '-'
  }

  private formatPath(exp: SimplifiedExperimentEntry): string {
    if (exp.rules && exp.rules.length > 0 && exp.rules[0].path) {
      const paths = exp.rules[0].path.split(',')
      if (paths.length > 1) {
        return `${paths[0]} (+${paths.length - 1})`
      }
      return paths[0]
    }
    return '-'
  }

  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) {
        return 'Today'
      } else if (diffDays === 1) {
        return 'Yesterday'
      } else if (diffDays < 7) {
        return `${diffDays}d ago`
      } else if (diffDays < 30) {
        return `${Math.floor(diffDays / 7)}w ago`
      } else if (diffDays < 365) {
        return `${Math.floor(diffDays / 30)}mo ago`
      } else {
        return `${Math.floor(diffDays / 365)}y ago`
      }
    } catch (error) {
      // Fallback to ISO format if parsing fails
      return isoDate.split('T')[0]
    }
  }
}
