import {Command, flags} from '@heroku-cli/command'

export default class Config extends Command {
  static description = 'Display HEROKU_XP configuration'

  static examples = [
    `$ heroku xp:config --app my-app-staging`,
    `$ heroku xp:config -a my-app-staging`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }

  async run() {
    const {flags} = await this.parse(Config)
    const appName = flags.app!

    try {
      const {body: configVars} = await this.heroku.get(`/apps/${appName}/config-vars`)
      const configVarsData = configVars as {HEROKU_XP?: string}

      if (!configVarsData.HEROKU_XP) {
        this.log('No HEROKU_XP configuration found.')
        this.log('')
        this.log('Create an experiment with: heroku xp:create')
        return
      }

      // Pretty-print the JSON
      try {
        const parsed = JSON.parse(configVarsData.HEROKU_XP)
        this.log(JSON.stringify(parsed, null, 2))
      } catch {
        // If parsing fails, just output the raw value
        this.log(configVarsData.HEROKU_XP)
      }
    } catch (error: any) {
      this.error(`Failed to fetch config: ${error.message}`)
    }
  }
}
