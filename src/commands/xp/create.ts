import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import * as crypto from 'crypto'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  createEmptySimplifiedConfig,
  findExperimentByKey,
  validateWeights,
} from '../../types/experiment'

export default class Create extends Command {
  static description = 'Create a new experiment app with traffic routing'

  static examples = [
    `$ heroku xp:create --app prod-app --branch feature-xyz`,
    `$ heroku xp:create --app prod-app --branch new-ui --weight 10`,
    `$ heroku xp:create --app prod-app --branch api-v2 --path /api/v2`,
    `$ heroku xp:create -a xp-demo-staging -b 1-green --weight 50 --path '/*' --mirror false`,
  ]

  private sanitizeErrorMessage(error: any): string {
    const message = error.message || String(error)
    // Strip UUIDs, app IDs, pipeline IDs
    return message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[ID]')
      .replace(/app-\d+/gi, '[APP]')
      .replace(/https?:\/\/[^\s]+/gi, '[URL]')
  }

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name for the experiment',
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
    region: flags.string({
      description: 'Heroku region',
    }),
    stack: flags.string({
      description: 'Heroku stack',
    }),
    mirror: flags.string({
      char: 'm',
      description: 'Enable mirroring for this experiment (true or false, default: true)',
    }),
  }

  async run() {
    const {flags} = await this.parse(Create)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      // Check if only branch is provided (no routing config)
      const hasRoutingConfig = flags.weight !== undefined || flags.path || flags.query || flags.header || flags.method || flags.mirror !== undefined

      if (!hasRoutingConfig) {
        // Show default experiment rules and confirm
        this.log('')
        this.log('Default experiment rules:')
        this.log('  method: GET')
        this.log('  weight: 10')
        this.log('  mirror: true')
        this.log('')

        const confirmed = await cli.confirm('Create experiment with these defaults? (y/n)')
        if (!confirmed) {
          this.log('Cancelled.')
          return
        }

        // Apply defaults
        flags.weight = 10
        flags.mirror = 'true'
        flags.method = 'GET'
      }

      // Start spinner
      cli.action.start('Creating experiment')

      // Step 1: Validate arguments
      this.validateArguments(branch, flags)

      // Step 2: Get parent app attributes via Heroku API
      const parentAppData = await this.getAppDetails(parentApp)

      // Step 3: Check for heroku-xp buildpack (add if missing)
      await this.ensureXpBuildpack(parentApp)

      // Step 4: Verify GitHub repo connection
      const repoData = await this.verifyGitHubRepo(parentAppData.id)

      // Step 5: Read HEROKU_XP config var and check for existing experiment
      const experimentsConfig = await this.getExperimentsConfig(parentApp)

      // Check if experiment with same parentApp+branch already exists (composite key)
      const existingExperiment = findExperimentByKey(experimentsConfig, parentApp, branch)
      const isUpdate = !!existingExperiment

      // Step 7: Check if parent app is in a pipeline
      const pipelineCoupling = await this.getPipelineCoupling(parentAppData.id)

      // Initialize reviewAppMode
      let reviewAppMode: 'standard' | 'review-app-existing' | 'review-app-new' = 'standard'

      // Step 7a-7h: Check for review app support and existing review apps
      try {
        const reviewAppCheck = await this.checkReviewAppSupport(
          pipelineCoupling,
          repoData,
          branch,
          isUpdate
        )

        if (reviewAppCheck.supported) {
          if (reviewAppCheck.existingApp) {
            // Step 7b: Existing review app found
            reviewAppMode = 'review-app-existing'
          } else {
            // Step 7c: No existing review app, create new one
            reviewAppMode = 'review-app-new'
          }
        }
      } catch (error: any) {
        // Step 7d: Fallback to standard mode on error
        reviewAppMode = 'standard'
      }

      // Step 8: Create or reuse experiment app (skip if review app mode)
      let experimentAppName: string
      let newAppData: any

      if (reviewAppMode === 'review-app-existing') {
        // Use existing review app
        const reviewAppCheck = await this.checkReviewAppSupport(
          pipelineCoupling,
          repoData,
          branch,
          isUpdate
        )
        // Get full app details from the review app's app reference
        const existingApp = reviewAppCheck.existingApp!

        // Review app response might have app.name or app.id
        experimentAppName = existingApp.app?.name || existingApp.app?.id

        if (!experimentAppName) {
          throw new Error(`Review app for branch ${branch} exists but has no app name or ID`)
        }

        newAppData = await this.getAppDetails(experimentAppName)
      } else if (reviewAppMode === 'review-app-new') {
        // Create new review app
        const tarballUrl = await this.getTarballUrl(repoData.repo, branch)

        // Fetch head SHA from pull-requests endpoint
        const headSha = await this.getHeadShaFromPullRequests(pipelineCoupling.pipeline.id, branch)

        const result = await this.createReviewApp(
          pipelineCoupling.pipeline.id,
          branch,
          tarballUrl,
          parentApp,
          repoData.repo,
          headSha
        )
        newAppData = result.appData
        experimentAppName = newAppData.name
      } else {
        // Standard mode: create or reuse experiment app
        experimentAppName = existingExperiment?.appName || this.generateAppName(branch, parentApp)

        if (isUpdate) {
          // Reuse existing app
          newAppData = await this.getAppDetails(experimentAppName)
        } else {
          // Create new experiment app via apps API
          newAppData = await this.createApp(
            experimentAppName,
            parentAppData,
            branch,
            flags
          )
        }
      }

      // Step 9: Copy buildpacks from parent app (skip if updating or review app mode)
      if (!isUpdate && reviewAppMode === 'standard') {
        await this.copyBuildpacks(parentAppData.name, experimentAppName)
      }

      // Step 10: Copy config vars from parent app (skip for new review apps - they get config from pipeline settings)
      if (reviewAppMode !== 'review-app-new') {
        await this.copyConfigVars(parentAppData.name, experimentAppName, branch)
      }

      // Step 11: Add to pipeline if parent app is in one (skip if updating or review app mode)
      if (pipelineCoupling && !isUpdate && reviewAppMode === 'standard') {
        await this.addToPipeline(newAppData.id, pipelineCoupling.pipeline.id, pipelineCoupling.stage)
      }

      // Step 12: Attach GitHub repo via kolkrabbi API (skip if updating or review app mode)
      if (!isUpdate && reviewAppMode === 'standard') {
        await this.attachGitHubRepo(newAppData.id, repoData.repo)
      }

      // Step 13: Enable auto-deploy for the branch (skip if review app mode)
      if (reviewAppMode === 'standard') {
        await this.enableAutoDeploy(newAppData.id, branch)
      }

      // Step 13a: Check if app has builds, then conditionally trigger initial deploy (skip if review app mode)
      if (reviewAppMode === 'standard') {
        let shouldDeploy = false
        try {
          const {body: builds} = await this.heroku.get(`/apps/${experimentAppName}/builds`, {
            headers: {Accept: 'application/vnd.heroku+json; version=3'},
          })
          const buildsArray = builds as any[]
          shouldDeploy = !buildsArray || buildsArray.length === 0
        } catch (error: any) {
          shouldDeploy = true
        }

        // Only trigger deploy if no builds exist
        if (shouldDeploy) {
          await this.triggerPush(newAppData.id, branch)
        }
      }

      // Step 14: Wait for app to boot and respond (skip if updating or new review app)
      if (!isUpdate && reviewAppMode !== 'review-app-new') {
        await this.waitForAppBoot(experimentAppName)
      }

      // Step 15: Update HEROKU_XP config var
      const newExperiment = this.buildSimplifiedExperimentEntry(
        parentApp,
        experimentAppName,
        newAppData.id,
        branch,
        repoData.repo,
        newAppData.web_url,
        existingExperiment,
        flags,
        reviewAppMode
      )

      if (isUpdate) {
        // Replace existing experiment
        const index = experimentsConfig.experiments.findIndex(
          exp => exp.parentApp === parentApp && exp.branch === branch
        )
        if (index !== -1) {
          experimentsConfig.experiments[index] = newExperiment
        }
      } else {
        // Add new experiment
        experimentsConfig.experiments.push(newExperiment)
      }

      await this.updateExperimentsConfig(parentApp, experimentsConfig)

      // Stop spinner
      cli.action.stop('')

      // Display created/updated experiment in table format
      this.log('')
      let successMessage = `${isUpdate ? 'Updated' : 'Created'} experiment`
      if (reviewAppMode === 'review-app-existing') {
        successMessage += ' (using existing review app)'
      } else if (reviewAppMode === 'review-app-new') {
        successMessage += ' (created as review app)'
      }
      this.log(`${successMessage}:`)
      this.log('')

      // Check if experiment is in mirror mode
      const isMirror = newExperiment.rules && newExperiment.rules.length > 0 && newExperiment.rules[0].mirror === true
      const mode = isMirror ? 'mirror' : 'live'
      const tableData = [{
        active: newExperiment.active !== false ? `✓ ${mode}` : '✗',
        branch: newExperiment.branch,
        route: this.formatRoute(newExperiment),
      }]

      cli.table(tableData, {
        active: {
          header: 'Active',
          minWidth: 15,
        },
        branch: {
          header: 'Branch',
          minWidth: 15,
        },
        route: {
          header: 'Route',
          minWidth: 20,
        },
      })

      this.log('')
      this.log(`heroku xp:watch --app ${parentApp}`)
      this.log('')

    } catch (error: any) {
      cli.action.stop('')
      this.error(`Failed to create experiment: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private validateArguments(branch: string, flags: any): void {
    // Validate branch name
    if (!/^[a-zA-Z0-9-_./]+$/.test(branch)) {
      throw new Error('Branch name contains invalid characters')
    }

    // Validate weight if provided
    if (flags.weight !== undefined) {
      if (flags.weight < 0 || flags.weight > 100) {
        throw new Error('Weight must be between 0 and 100')
      }
    }

    // Validate query parameters format
    if (flags.query) {
      for (const query of flags.query) {
        if (!query.includes('=')) {
          throw new Error(`Invalid query parameter format: "${query}". Use format: key=value`)
        }
      }
    }

    // Validate header format
    if (flags.header) {
      for (const header of flags.header) {
        if (!header.includes('=')) {
          throw new Error(`Invalid header format: "${header}". Use format: key=value`)
        }
      }
    }
  }

  private async getAppDetails(appName: string): Promise<any> {
    try {
      const {body: app} = await this.heroku.get(`/apps/${appName}`)
      return app
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new Error(`App "${appName}" not found`)
      }
      throw new Error(`Failed to fetch app details: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async ensureXpBuildpack(appName: string): Promise<void> {
    try {
      // Get current buildpacks
      const {body: buildpacks} = await this.heroku.get(`/apps/${appName}/buildpack-installations`)
      const buildpacksArray = buildpacks as any[]

      // Check if heroku-xp buildpack exists
      const xpBuildpackUrl = 'https://dyno-proxy-buildpack-staging-2ca242c0008d.herokuapp.com/buildpack-v1alpha1.tgz'
      const hasXpBuildpack = buildpacksArray.some((bp: any) =>
        bp.buildpack.url === xpBuildpackUrl ||
        bp.buildpack.url.includes('dyno-proxy-buildpack') ||
        bp.buildpack.url.includes('heroku-buildpack-experiments')
      )

      if (!hasXpBuildpack) {
        // Add the buildpack at the end
        try {
          await this.heroku.put(`/apps/${appName}/buildpack-installations`, {
            body: {
              updates: [
                ...buildpacksArray.map((bp: any, index: number) => ({
                  buildpack: bp.buildpack.url,
                  ordinal: index,
                })),
                {
                  buildpack: xpBuildpackUrl,
                  ordinal: buildpacksArray.length,
                },
              ],
            },
          })
        } catch (error: any) {
          throw new Error(`Unable to add heroku-xp buildpack: ${this.sanitizeErrorMessage(error)}`)
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to configure buildpacks: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async verifyGitHubRepo(appId: string): Promise<{repo: string; id: number}> {
    try {
      // Use kolkrabbi API (repositories-api) to check GitHub connection
      // Note: Kolkrabbi requires app UUID, not app name
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'
      const {body: repoInfo} = await this.heroku.get(
        `${kolkrabbiUrl}/apps/${appId}/github`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
        }
      )
      const repoData = repoInfo as {repo?: string; id?: number}

      if (!repoData || !repoData.repo) {
        throw new Error('No GitHub repository connected')
      }

      if (!repoData.id) {
        throw new Error('GitHub repository connection is missing repository ID')
      }

      return {
        repo: repoData.repo,
        id: repoData.id,
      }
    } catch (error: any) {
      if (error.message.includes('No GitHub repository')) {
        throw error
      }
      throw new Error(`Failed to verify GitHub connection: ${this.sanitizeErrorMessage(error)}. Ensure the app is connected to a GitHub repository.`)
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
          throw new Error(`Failed to parse HEROKU_XP config: ${this.sanitizeErrorMessage(error)}`)
        }
      }

      // Return empty v2 config if HEROKU_XP doesn't exist
      return createEmptySimplifiedConfig()
    } catch (error: any) {
      throw new Error(`Failed to read experiment configuration: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private generateAppName(branch: string, parentApp: string): string {
    // Generate app name: {parent-app-name}-xp-{branch}-{rand}
    // Max 30 chars for Heroku app names, only lowercase letters, numbers, and dashes
    // Priority: xp (min 3), rand (min 3), parent (min 3), branch (min 3)
    const rand = crypto.randomBytes(2).toString('hex') // 4 chars
    const xpMarker = 'xp' // 2 chars

    // Sanitize branch name: lowercase, replace invalid chars with dashes
    const sanitizedBranch = branch
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    // Calculate available space: 30 - 3 dashes - 2 (xp) = 25 chars for parent+branch+rand
    const dashes = 3
    const available = 30 - xpMarker.length - dashes

    // Minimum lengths (priority order: xp, rand, parent, branch)
    const minRand = 3
    const minParent = 3
    const minBranch = 3

    // Start with full lengths
    let parentLen = parentApp.length
    let branchLen = sanitizedBranch.length
    let randLen = rand.length

    const total = () => parentLen + branchLen + randLen

    // Trim in priority order: branch first, then parent, then rand
    if (total() > available) {
      const excess = total() - available
      // Try trimming branch first
      const branchTrim = Math.min(excess, Math.max(0, branchLen - minBranch))
      branchLen -= branchTrim

      if (total() > available) {
        // Still too long, trim parent
        const parentTrim = Math.min(total() - available, Math.max(0, parentLen - minParent))
        parentLen -= parentTrim

        if (total() > available) {
          // Still too long, trim rand (lowest priority)
          randLen = Math.max(minRand, randLen - (total() - available))
        }
      }
    }

    const appName = `${parentApp.slice(0, parentLen)}-${xpMarker}-${sanitizedBranch.slice(0, branchLen)}-${rand.slice(0, randLen)}`
    return appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30)
  }

  private async getPipelineCoupling(appId: string): Promise<any> {
    try {
      const {body: coupling} = await this.heroku.get(`/apps/${appId}/pipeline-couplings`)
      return coupling
    } catch (error: any) {
      // Not found means app is not in a pipeline
      if (error.statusCode === 404) {
        return null
      }
      throw error
    }
  }

  private async createApp(
    appName: string,
    parentApp: any,
    branch: string,
    flags: any
  ): Promise<any> {
    try {
      // Check if parent app is owned by a team
      const teamId = parentApp.team?.id || parentApp.organization?.id

      const payload: any = {
        name: appName,
        region: flags.region || parentApp.region?.name || parentApp.region,
        stack: flags.stack || parentApp.stack?.name || parentApp.stack,
      }

      // Use teams endpoint if parent app is owned by team
      if (teamId) {
        payload.team = teamId
        const {body: app} = await this.heroku.post('/teams/apps', {
          body: payload,
        })
        return app
      }

      // Otherwise use standard apps endpoint
      const {body: app} = await this.heroku.post('/apps', {
        body: payload,
      })
      return app
    } catch (error: any) {
      throw new Error(`Failed to create app: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async copyBuildpacks(parentAppName: string, experimentAppName: string): Promise<void> {
    try {
      // Get parent app buildpacks
      const {body: parentBuildpacks} = await this.heroku.get(
        `/apps/${parentAppName}/buildpack-installations`
      )
      const buildpacksArray = parentBuildpacks as any[]

      // Update buildpacks on experiment app
      const buildpackUpdates = buildpacksArray.map((bp: any) => ({
        buildpack: bp.buildpack.url,
      }))

      await this.heroku.put(`/apps/${experimentAppName}/buildpack-installations`, {
        body: {
          updates: buildpackUpdates,
        },
      })
    } catch (error: any) {
      throw new Error(`Failed to copy buildpacks: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async copyConfigVars(
    parentAppName: string,
    experimentAppName: string,
    branch: string
  ): Promise<void> {
    try {
      // Get parent app config vars
      const {body: parentConfigVars} = await this.heroku.get(
        `/apps/${parentAppName}/config-vars`
      )

      // Filter out sensitive config vars using comprehensive blocklist
      // Security: Block all vars that may contain secrets, keys, tokens, passwords, or credentials
      const sensitivePatterns = [
        /SECRET/i,
        /KEY/i,
        /TOKEN/i,
        /PASSWORD/i,
        /CREDENTIAL/i,
        /AWS_/i,
        /STRIPE_/i,
        /SENTRY_DSN/i,
        /^DATABASE_URL$/,
        /^REDIS_URL$/,
        /^HEROKU_XP$/,
        /API_KEY/i,
        /PRIVATE/i,
        /AUTH/i,
        /OAUTH/i,
      ]

      const configVarsToCopy: {[key: string]: string} = {
        HEROKU_EXPERIMENT_BRANCH: branch,
        HEROKU_EXPERIMENT_PARENT: parentAppName,
        HEROKU_EXPERIMENT_CREATED: new Date().toISOString(),
      }

      for (const [key, value] of Object.entries(parentConfigVars as Record<string, any>)) {
        // Skip if matches any sensitive pattern
        const isSensitive = sensitivePatterns.some(pattern => pattern.test(key))
        if (!isSensitive && typeof value === 'string') {
          configVarsToCopy[key] = value
        }
      }

      // Update config vars on experiment app
      await this.heroku.patch(`/apps/${experimentAppName}/config-vars`, {
        body: configVarsToCopy,
      })
    } catch (error: any) {
      throw new Error(`Failed to copy config vars: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async addToPipeline(appId: string, pipelineId: string, stage: string): Promise<void> {
    try {
      await this.heroku.post('/pipeline-couplings', {
        body: {
          app: appId,
          pipeline: pipelineId,
          stage: stage,
        },
      })
    } catch (error: any) {
      throw new Error(`Failed to add app to pipeline: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async attachGitHubRepo(appId: string, repoName: string): Promise<void> {
    try {
      // Kolkrabbi requires app UUID, not app name
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      await this.heroku.post(
        `${kolkrabbiUrl}/apps/${appId}/github`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
          body: {
            repo: repoName,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to attach GitHub repo: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async enableAutoDeploy(appId: string, branch: string): Promise<void> {
    try {
      // Kolkrabbi requires app UUID, not app name
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      await this.heroku.patch(
        `${kolkrabbiUrl}/apps/${appId}/github`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
          body: {
            auto_deploy: true,
            branch: branch,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to enable auto-deploy: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async triggerPush(appId: string, branch: string): Promise<void> {
    try {
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      await this.heroku.post(
        `${kolkrabbiUrl}/apps/${appId}/github/push`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
          body: {
            branch: branch,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to trigger push: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async waitForAppBoot(appName: string): Promise<void> {
    const maxAttempts = 60 // 5 minutes
    const pollInterval = 5000 // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check releases endpoint for deployment status
        const {body: releases} = await this.heroku.get(`/apps/${appName}/releases`, {
          headers: {
            'Range': 'version ..; order=desc,max=1',
          },
        })
        const releasesArray = releases as any[]

        if (releasesArray && releasesArray.length > 0) {
          const latestRelease = releasesArray[0]

          // Check if release succeeded
          if (latestRelease.status === 'succeeded') {
            // Verify it's not just the initial release (v1 with no slug)
            if (latestRelease.version > 1 || latestRelease.slug) {
              // App is ready
              return
            }
          } else if (latestRelease.status === 'failed') {
            throw new Error(`Build failed: ${latestRelease.description || 'Unknown error'}`)
          }
          // If status is 'pending', continue polling
        }
      } catch (error: any) {
        // If it's a known failure, propagate it
        if (error.message && error.message.includes('Build failed')) {
          throw error
        }
        // Otherwise continue polling
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    // Don't fail if app doesn't boot immediately - it may still be deploying
    this.warn('Warning: App may still be booting. Check status with: heroku ps --app ' + appName)
  }

  private buildSimplifiedExperimentEntry(
    parentApp: string,
    experimentAppName: string,
    appID: string,
    branch: string,
    repo: string,
    url: string | undefined,
    existingExperiment: SimplifiedExperimentEntry | undefined,
    flags: any,
    reviewAppMode?: 'standard' | 'review-app-existing' | 'review-app-new'
  ): SimplifiedExperimentEntry {
    const now = new Date().toISOString()

    // Validate header/query for CRLF injection
    const validateNoNewlines = (value: string, type: string) => {
      if (/[\r\n]/.test(value)) {
        throw new Error(`Invalid ${type}: contains newline characters`)
      }
    }

    // Build rules array
    const rules: any[] = []

    // Create rule if any routing parameters exist
    const hasRoutingConfig = flags.weight !== undefined || flags.path || flags.query || flags.header || flags.method

    if (hasRoutingConfig) {
      const rule: any = {}

      // Mirror defaults to true if not specified
      // Parse string flag: 'false' -> false, 'true' or undefined -> true
      if (flags.mirror !== undefined) {
        const mirrorValue = flags.mirror.toLowerCase()
        rule.mirror = mirrorValue !== 'false' && mirrorValue !== '0' && mirrorValue !== 'no'
      } else {
        rule.mirror = true
      }

      if (flags.weight !== undefined) {
        rule.weight = flags.weight
      }

      // Convert path array to comma-separated string
      if (flags.path && Array.isArray(flags.path)) {
        rule.path = flags.path.join(',')
      }

      // Convert query array to string format "key: value"
      if (flags.query && Array.isArray(flags.query)) {
        // Take first query param for now (format: "key=value" -> "key: value")
        // Handle multiple = signs correctly
        const [key, ...valueParts] = flags.query[0].split('=')
        const value = valueParts.join('=')
        validateNoNewlines(key, 'query key')
        validateNoNewlines(value, 'query value')
        rule.query = `${key}: ${value}`
      }

      // Convert header array to string format "key: value"
      if (flags.header && Array.isArray(flags.header)) {
        // Take first header for now (format: "key=value" -> "key: value")
        // Handle multiple = signs correctly
        const [key, ...valueParts] = flags.header[0].split('=')
        const value = valueParts.join('=')
        validateNoNewlines(key, 'header key')
        validateNoNewlines(value, 'header value')
        rule.header = `${key}: ${value}`
      }

      if (flags.method) {
        rule.method = flags.method
      } else {
        rule.method = 'GET'  // Default method
      }

      rules.push(rule)
    }

    const entry: SimplifiedExperimentEntry = {
      appName: experimentAppName,
      appID,
      parentApp,
      branch,
      version: existingExperiment ? existingExperiment.version + 1 : 1,
      repo,
      url: url || '',
      rules,
      createdAt: existingExperiment?.createdAt || now,
      updatedAt: now,
    }

    return entry
  }

  private formatRoute(exp: SimplifiedExperimentEntry): string {
    if (!exp.rules || exp.rules.length === 0) {
      return '-'
    }

    const rule = exp.rules[0]
    const parts: string[] = []

    // Add weight if specified
    if (rule.weight !== undefined) {
      parts.push(`${rule.weight}%`)
    }

    // Add method if specified and not GET (GET is default)
    if (rule.method && rule.method !== 'GET') {
      parts.push(rule.method)
    }

    // Add path if specified
    if (rule.path) {
      const paths = rule.path.split(',')
      if (paths.length > 1) {
        parts.push(`${paths[0]} (+${paths.length - 1})`)
      } else {
        parts.push(paths[0])
      }
    }

    // Add query if specified
    if (rule.query) {
      parts.push(`?${rule.query}`)
    }

    // Add header if specified
    if (rule.header) {
      parts.push(`header:${rule.header}`)
    }

    return parts.length > 0 ? parts.join(' ') : '-'
  }

  private async updateExperimentsConfig(
    appName: string,
    config: SimplifiedExperimentsConfig
  ): Promise<void> {
    try {
      // Validate total weight doesn't exceed 100% for each routing group
      validateWeights(config)

      // Validate config size (max 32KB for Heroku config vars)
      const configJson = JSON.stringify(config, null, 2)
      const configSize = Buffer.byteLength(configJson, 'utf8')
      const maxSize = 32 * 1024 // 32KB

      if (configSize > maxSize) {
        throw new Error(
          `HEROKU_XP config would exceed 32KB limit (${configSize} bytes). ` +
          'Remove old experiments with: heroku xp:destroy'
        )
      }

      // Update config var
      await this.heroku.patch(`/apps/${appName}/config-vars`, {
        body: {
          HEROKU_XP: configJson,
        },
      })
    } catch (error: any) {
      throw new Error(`Failed to update experiment configuration: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    const retryableStatusCodes = [408, 429, 502, 503, 504]
    const retryableNetworkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error: any) {
        // Don't retry on last attempt
        if (attempt === maxRetries) {
          throw error
        }

        // Check if error is retryable
        const isRetryableStatus = error.statusCode && retryableStatusCodes.includes(error.statusCode)
        const isRetryableNetwork = error.code && retryableNetworkErrors.includes(error.code)

        if (!isRetryableStatus && !isRetryableNetwork) {
          throw error
        }

        // Calculate delay with exponential backoff and jitter
        const baseDelay = Math.pow(2, attempt) * 100 // 100ms, 200ms, 400ms
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1) // +/-20% jitter
        const delay = baseDelay + jitter

        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    // TypeScript needs this even though we throw above
    throw new Error('Retry logic error')
  }

  private async listReviewApps(pipelineId: string, branch: string): Promise<any | null> {
    try {
      const {body: reviewApps} = await this.heroku.get(`/pipelines/${pipelineId}/review-apps`, {
        headers: {
          'Accept': 'application/vnd.heroku+json; version=3',
        },
      })
      const reviewAppsArray = reviewApps as any[]

      // Filter by branch
      const matchingReviewApps = reviewAppsArray.filter(
        (app: any) => app.branch === branch
      )

      if (matchingReviewApps.length === 0) {
        return null
      }

      // Filter out only truly unusable review apps (errored, failed, deleted)
      // Keep apps with status: pending, creating, succeeded, deployed, etc.
      const relevantReviewApps = matchingReviewApps.filter(
        (app: any) => app.status !== 'errored' && app.status !== 'failed' && app.status !== 'deleted'
      )

      if (relevantReviewApps.length === 0) {
        return null
      }

      // Return most recent (sort by created_at descending)
      relevantReviewApps.sort((a: any, b: any) => {
        const dateA = new Date(a.created_at).getTime()
        const dateB = new Date(b.created_at).getTime()
        return dateB - dateA
      })

      return relevantReviewApps[0]
    } catch (error: any) {
      // Return null on error as specified
      return null
    }
  }

  private async getHeadShaFromPullRequests(pipelineId: string, branch: string): Promise<string | null> {
    try {
      const {body: pullRequests} = await this.heroku.get(
        `/pipelines/${pipelineId}/repo/pull-requests`,
        {
          headers: {
            'Accept': 'application/vnd.heroku+json; version=3.repositories-api',
          },
        }
      )

      const pullRequestsArray = pullRequests as any[]

      // Find PR matching the branch
      const matchingPR = pullRequestsArray.find(
        (pr: any) => pr.head?.ref === branch
      )

      // Return the head SHA if found
      return matchingPR?.head?.sha || null
    } catch (error: any) {
      // Return null on error - SHA is optional
      return null
    }
  }

  private async getTarballUrl(repoName: string, branch: string): Promise<string> {
    try {
      // Validate repoName has slash (owner/repo format)
      if (!repoName.includes('/')) {
        throw new Error(`Invalid repository name format: "${repoName}". Expected format: owner/repo`)
      }

      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      // Request tarball URL from Kolkrabbi
      const {body: tarballResponse} = await this.heroku.get(
        `${kolkrabbiUrl}/github/repos/${repoName}/tarball/${branch}`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
        }
      )

      const tarballData = tarballResponse as any

      // Extract the archive URL from the response
      // Kolkrabbi may return the URL directly or in various object properties
      let tarballUrl: string | undefined

      if (typeof tarballData === 'string') {
        tarballUrl = tarballData
      } else if (tarballData) {
        // Try different possible property names
        tarballUrl = tarballData.archive_link || tarballData.archive_url || tarballData.url
      }

      if (!tarballUrl) {
        throw new Error(`Kolkrabbi did not return a tarball URL for ${repoName}:${branch}`)
      }

      return tarballUrl
    } catch (error: any) {
      throw new Error(`Failed to get tarball URL from Kolkrabbi: ${this.sanitizeErrorMessage(error)}`)
    }
  }

  private async checkReviewAppSupport(
    pipelineCoupling: any,
    repoData: {repo: string; id: number},
    branch: string,
    isUpdate: boolean
  ): Promise<{supported: boolean; existingApp?: any}> {
    // Return not supported if not in a pipeline
    if (!pipelineCoupling) {
      return {supported: false}
    }

    // Validate pipeline ID exists
    if (!pipelineCoupling.pipeline || !pipelineCoupling.pipeline.id) {
      return {supported: false}
    }

    // Return not supported if this is an update
    if (isUpdate) {
      return {supported: false}
    }

    // Check for existing review app
    const existingReviewApp = await this.listReviewApps(pipelineCoupling.pipeline.id, branch)

    if (existingReviewApp) {
      return {supported: true, existingApp: existingReviewApp}
    }

    // No existing review app found
    return {supported: true}
  }

  private async createReviewApp(
    pipelineId: string,
    branch: string,
    tarballUrl: string,
    parentAppName: string,
    repoName: string,
    headSha?: string | null
  ): Promise<{appData: any}> {
    try {
      // Validate tarball URL format (Kolkrabbi or GitHub)
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'
      const isValidUrl = tarballUrl.startsWith(`${kolkrabbiUrl}/github/repos/`) ||
                         tarballUrl.startsWith(`${kolkrabbiUrl}/source/archive/`) ||
                         tarballUrl.startsWith('https://api.github.com/') ||
                         tarballUrl.startsWith('https://codeload.github.com/')

      if (!isValidUrl) {
        throw new Error(`Invalid tarball URL format: ${tarballUrl}. Expected Kolkrabbi or GitHub URL`)
      }

      // Validate pipeline ID format
      if (!pipelineId || typeof pipelineId !== 'string') {
        throw new Error(`Invalid pipeline ID: ${pipelineId}`)
      }

      // Construct environment object with parent app name
      const environment: Record<string, string> = {
        HEROKU_EXPERIMENT_BRANCH: branch,
        HEROKU_EXPERIMENT_PARENT: parentAppName,
        HEROKU_EXPERIMENT_CREATED: new Date().toISOString(),
      }

      // Construct source_blob with version (head SHA or empty string)
      const source_blob: {url: string; version: string} = {
        url: tarballUrl,
        version: headSha || '',
      }

      // Create review app
      const {body: reviewApp} = await this.heroku.post('/review-apps', {
        headers: {
          'Accept': 'application/vnd.heroku+json; version=3',
        },
        body: {
          branch,
          pipeline: pipelineId,
          source_blob,
          environment,
        },
      })

      const reviewAppData = reviewApp as any

      if (!reviewAppData || !reviewAppData.id) {
        throw new Error('Review app creation returned invalid response: missing review app ID')
      }

      // Poll for app data to be populated
      // The app field is initially null and gets populated asynchronously
      const reviewAppId = reviewAppData.id
      const maxAttempts = 60 // 5 minutes
      const pollInterval = 5000 // 5 seconds

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const {body: reviewAppStatus} = await this.heroku.get(`/review-apps/${reviewAppId}`, {
            headers: {
              'Accept': 'application/vnd.heroku+json; version=3',
            },
          })
          const statusData = reviewAppStatus as any

          // Check for error status first
          if (statusData.status === 'errored' || statusData.status === 'failed') {
            throw new Error(`Review app creation failed: ${statusData.error_status || statusData.message || 'Unknown error'}`)
          }

          // Check if app ID is available
          if (statusData.app && statusData.app.id) {
            // Fetch full app details directly from apps endpoint
            const {body: appDetails} = await this.heroku.get(`/apps/${statusData.app.id}`)
            return {appData: appDetails}
          }

          // Status is still pending/creating, continue polling

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        } catch (error: any) {
          // If it's our thrown error, propagate it
          if (error.message && error.message.includes('Review app creation failed')) {
            throw error
          }
          // Otherwise continue polling
        }
      }

      // Timeout waiting for app data
      throw new Error(`Timed out waiting for review app to provision. Review app ID: ${reviewAppId}`)
    } catch (error: any) {
      // Provide contextual error messages
      if (error.statusCode === 404) {
        throw new Error(`Pipeline not found: ${pipelineId}. Ensure the app is in a pipeline with review apps enabled`)
      } else if (error.statusCode === 422) {
        throw new Error(`Failed to create review app: ${this.sanitizeErrorMessage(error)}. Check that review apps are enabled for this pipeline and the branch exists in repository ${repoName}`)
      } else if (error.statusCode === 403) {
        throw new Error(`Permission denied: Cannot create review app in pipeline. Ensure you have access to this pipeline`)
      }

      throw new Error(`Failed to create review app: ${this.sanitizeErrorMessage(error)}`)
    }
  }

}
