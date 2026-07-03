import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import * as https from 'https'
import * as http from 'http'
import createDebug from 'debug'
import {
  SimplifiedExperimentsConfig,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  createEmptySimplifiedConfig,
} from '../../types/experiment'

const debug = createDebug('heroku:xp:watch')

interface MetricCounters {
  durationSum: number
  durationCount: number
  total200: number
  totalErrors: number
  timestamp: number
}

interface ExperimentMetrics {
  [key: string]: string
  experiment: string
  branch: string
  avgResponseTime: string
  errorRate: string
  throughput: string
}

export default class Watch extends Command {
  static description = 'Monitor experiment performance metrics in real-time'

  static examples = [
    `$ heroku xp:watch --app xp-demo-staging`,
    `$ heroku xp:watch -a prod-app`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }

  private previousCounters: Map<string, MetricCounters> = new Map()
  private isRunning = false

  async run() {
    const {flags} = await this.parse(Watch)
    const appName = flags.app!

    debug('Starting watch for app: %s', appName)
    this.isRunning = true

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      debug('Received SIGINT, stopping watch')
      this.isRunning = false
      this.log('\n\nStopping watch...')
      process.exit(0)
    })

    try {
      while (this.isRunning) {
        debug('Fetching metrics iteration for app: %s', appName)
        await this.fetchAndDisplayMetrics(appName)

        if (this.isRunning) {
          debug('Sleeping for 15 seconds before next update')
          // Wait 15 seconds before next update
          await this.sleep(15000)
        }
      }
    } catch (error: any) {
      debug('Fatal error in watch loop: %s', error.message)
      this.error(`Failed to watch experiments: ${error.message}`)
    }
  }

  private async fetchAndDisplayMetrics(appName: string) {
    try {
      debug('Fetching experiment configuration for app: %s', appName)
      // Fetch experiment configuration
      const experimentsConfig = await this.getExperimentsConfig(appName)
      debug('Retrieved %d experiments from config', experimentsConfig.experiments.length)

      if (experimentsConfig.experiments.length === 0) {
        debug('No experiments configured, displaying empty state')
        console.clear()
        this.log('\nNo experiments configured.\n')
        return
      }

      // Fetch parent app info to get web_url
      debug('Fetching parent app details for: %s', appName)
      const {body: parentApp} = await this.heroku.get(`/apps/${appName}`)
      const parentWebUrl = parentApp.web_url
      debug('Parent app web_url: %s', parentWebUrl)

      if (!parentWebUrl) {
        throw new Error(`Parent app ${appName} has no web_url`)
      }

      debug('Fetching metrics for %d experiments using parent URL: %s', experimentsConfig.experiments.length, parentWebUrl)
      // Fetch metrics for each experiment using parent app URL
      const metricsPromises = experimentsConfig.experiments.map((exp, idx) => {
        debug('Experiment %d: appName=%s, branch=%s', idx + 1, exp.appName, exp.branch)
        return this.fetchExperimentMetrics(exp.appName, exp.branch, parentWebUrl)
      })

      const metricsResults = await Promise.all(metricsPromises)
      debug('Successfully fetched metrics for %d experiments', metricsResults.length)

      // Clear screen and display
      console.clear()
      this.log(`\nExperiment Metrics - ${appName}`)
      this.log(`Last updated: ${new Date().toLocaleTimeString()}\n`)

      // Display table
      cli.table(metricsResults, {
        experiment: {
          header: 'Experiment',
          minWidth: 25,
        },
        branch: {
          header: 'Branch',
          minWidth: 20,
        },
        avgResponseTime: {
          header: 'Avg Response',
          minWidth: 15,
        },
        errorRate: {
          header: 'Error %',
          minWidth: 10,
        },
        throughput: {
          header: 'Throughput',
          minWidth: 12,
        },
      })

      this.log('\nPress Ctrl+C to exit\n')
    } catch (error: any) {
      debug('Error in fetchAndDisplayMetrics: %s', error.message)
      console.clear()
      this.log(`\nError fetching metrics: ${error.message}`)
      this.log('Retrying in 15 seconds...\n')
    }
  }

  private async fetchExperimentMetrics(
    appName: string,
    branch: string,
    parentWebUrl: string
  ): Promise<ExperimentMetrics> {
    try {
      debug('fetchExperimentMetrics: appName=%s, branch=%s, parentWebUrl=%s', appName, branch, parentWebUrl)
      const metricsUrl = `${parentWebUrl}/.dyno-proxy/metrics/`
      debug('Fetching metrics from parent app URL: %s', metricsUrl)
      const metricsText = await this.fetchUrl(metricsUrl)
      debug('Successfully fetched metrics, response length: %d bytes', metricsText.length)

      const routerLabel = `${appName}-experiment@file`
      debug('Parsing Prometheus metrics for router label: %s', routerLabel)
      const metrics = this.parsePrometheusMetrics(metricsText, routerLabel)

      if (!metrics) {
        debug('No metrics found for router label: %s', routerLabel)
        return {
          experiment: appName,
          branch,
          avgResponseTime: 'N/A',
          errorRate: 'N/A',
          throughput: 'N/A',
        }
      }

      debug('Parsed metrics: durationSum=%f, durationCount=%f, total200=%f, totalErrors=%f',
        metrics.durationSum, metrics.durationCount, metrics.total200, metrics.totalErrors)

      // Calculate average response time
      const avgResponseTime = metrics.durationCount > 0
        ? ((metrics.durationSum / metrics.durationCount) * 1000).toFixed(2) + ' ms'
        : 'N/A'
      debug('Calculated avgResponseTime: %s (durationSum=%f, durationCount=%f)',
        avgResponseTime, metrics.durationSum, metrics.durationCount)

      // Calculate error rate
      const totalRequests = metrics.total200 + metrics.totalErrors
      const errorRate = totalRequests > 0
        ? ((metrics.totalErrors / totalRequests) * 100).toFixed(2) + '%'
        : '0.00%'
      debug('Calculated errorRate: %s (totalErrors=%f, totalRequests=%f)',
        errorRate, metrics.totalErrors, totalRequests)

      // Calculate throughput (requests per second)
      let throughput = 'N/A'
      const key = appName
      const previous = this.previousCounters.get(key)

      if (previous) {
        const timeDiff = (metrics.timestamp - previous.timestamp) / 1000 // seconds
        const requestDiff = (metrics.total200 - previous.total200) +
                           (metrics.totalErrors - previous.totalErrors)

        debug('Calculating throughput: requestDiff=%f, timeDiff=%fs',
          requestDiff, timeDiff)

        if (timeDiff > 0) {
          const rps = requestDiff / timeDiff
          throughput = rps >= 0 ? rps.toFixed(2) + ' req/s' : '0.00 req/s'
          debug('Calculated throughput: %s (rps=%f)', throughput, rps)
        }
      } else {
        debug('No previous counters found for %s, throughput will be N/A', key)
      }

      // Store current counters for next iteration
      this.previousCounters.set(key, metrics)
      debug('Stored current counters for next iteration')

      return {
        experiment: appName,
        branch,
        avgResponseTime,
        errorRate,
        throughput,
      }
    } catch (error: any) {
      debug('Error in fetchExperimentMetrics: %s', error.message)
      return {
        experiment: appName,
        branch,
        avgResponseTime: 'Error',
        errorRate: 'Error',
        throughput: 'Error',
      }
    }
  }

  private parsePrometheusMetrics(text: string, routerLabel: string): MetricCounters | null {
    debug('parsePrometheusMetrics: looking for router label: %s', routerLabel)
    const lines = text.split('\n')
    debug('Parsing %d lines of Prometheus metrics', lines.length)

    const metrics: Partial<MetricCounters> = {
      durationSum: 0,
      durationCount: 0,
      total200: 0,
      totalErrors: 0,
      timestamp: Date.now(),
    }

    const metricRegex = /^(\w+)\{([^}]+)\}\s+([\d.e+-]+)$/
    let matchedLines = 0
    let skippedComments = 0
    let skippedEmpty = 0
    let skippedWrongRouter = 0

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.startsWith('#')) {
        skippedComments++
        continue
      }
      if (!line.trim()) {
        skippedEmpty++
        continue
      }

      const match = line.match(metricRegex)
      if (!match) {
        continue
      }

      const [, metricName, labelsStr, valueStr] = match
      const value = parseFloat(valueStr)

      // Parse labels
      const labels = this.parseLabels(labelsStr)

      if (labels.router !== routerLabel) {
        skippedWrongRouter++
        continue
      }

      matchedLines++
      debug('Matched metric line: %s=%f, labels=%s', metricName, value, labelsStr)

      // Extract relevant metrics
      if (metricName === 'traefik_router_request_duration_seconds_sum') {
        metrics.durationSum = value
        debug('Found durationSum: %f', value)
      } else if (metricName === 'traefik_router_request_duration_seconds_count') {
        metrics.durationCount = value
        debug('Found durationCount: %f', value)
      } else if (metricName === 'traefik_router_requests_total') {
        if (labels.code === '200') {
          metrics.total200 = value
          debug('Found total200: %f', value)
        } else if (labels.code && (labels.code.startsWith('4') || labels.code.startsWith('5'))) {
          metrics.totalErrors = (metrics.totalErrors || 0) + value
          debug('Found error (code=%s): %f, totalErrors now: %f', labels.code, value, metrics.totalErrors)
        }
      }
    }

    debug('Parsing summary: matched=%d, skipped (comments=%d, empty=%d, wrongRouter=%d)',
      matchedLines, skippedComments, skippedEmpty, skippedWrongRouter)

    // Return null if no metrics found
    if (metrics.durationCount === 0 && metrics.total200 === 0 && metrics.totalErrors === 0) {
      debug('No relevant metrics found for router: %s', routerLabel)
      return null
    }

    debug('Successfully parsed metrics: durationSum=%f, durationCount=%f, total200=%f, totalErrors=%f',
      metrics.durationSum, metrics.durationCount, metrics.total200, metrics.totalErrors)
    return metrics as MetricCounters
  }

  private parseLabels(labelsStr: string): {[key: string]: string} {
    const labels: {[key: string]: string} = {}
    const pairs = labelsStr.match(/(\w+)="([^"]*)"/g)

    if (pairs) {
      debug('parseLabels: found %d label pairs in "%s"', pairs.length, labelsStr)
      for (const pair of pairs) {
        const match = pair.match(/(\w+)="([^"]*)"/)
        if (match) {
          labels[match[1]] = match[2]
        }
      }
    } else {
      debug('parseLabels: no label pairs found in "%s"', labelsStr)
    }

    return labels
  }

  private fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      debug('fetchUrl: protocol=%s, url=%s', protocol === https ? 'https' : 'http', url)

      const startTime = Date.now()
      const req = protocol.get(url, res => {
        debug('HTTP Response: status=%d, statusMessage=%s, headers=%j',
          res.statusCode, res.statusMessage, res.headers)

        let data = ''
        let chunks = 0

        res.on('data', chunk => {
          chunks++
          data += chunk
        })

        res.on('end', () => {
          const duration = Date.now() - startTime
          debug('HTTP Response completed: status=%d, duration=%dms, chunks=%d, bodyLength=%d',
            res.statusCode, duration, chunks, data.length)

          if (res.statusCode === 200) {
            debug('First 200 chars of response body: %s',
              data.substring(0, 200).replace(/\n/g, '\\n'))
            resolve(data)
          } else {
            const error = `HTTP ${res.statusCode}: Failed to fetch metrics`
            debug('HTTP Error: %s', error)
            reject(new Error(error))
          }
        })
      })

      req.on('error', err => {
        debug('HTTP Request error: %s', err.message)
        reject(err)
      })

      debug('HTTP Request sent: method=GET, url=%s', url)
    })
  }

  private async getExperimentsConfig(appName: string): Promise<SimplifiedExperimentsConfig> {
    try {
      debug('getExperimentsConfig: fetching config vars for app: %s', appName)
      const endpoint = `/apps/${appName}/config-vars`
      debug('HTTP Request to Heroku API: GET %s', endpoint)

      const {body: configVars} = await this.heroku.get(endpoint)
      const configVarsData = configVars as {HEROKU_XP?: string}

      debug('Heroku API response received for config-vars')

      if (configVarsData.HEROKU_XP) {
        debug('HEROKU_XP config found, length: %d chars', configVarsData.HEROKU_XP.length)
        debug('HEROKU_XP value preview: %s', configVarsData.HEROKU_XP.substring(0, 100))

        try {
          const config: AnyExperimentsConfig = parseExperimentsConfig(configVarsData.HEROKU_XP)
          debug('Successfully parsed HEROKU_XP config')

          // Migrate v1 to v2 if needed
          if (!isSimplifiedConfig(config)) {
            debug('Config is v1 format, migrating to v2')
            const migratedConfig = migrateToSimplified(config)
            debug('Successfully migrated config to v2')
            return migratedConfig
          }

          debug('Config is already v2 format')
          return config
        } catch (error: any) {
          debug('Failed to parse HEROKU_XP config: %s', error.message)
          throw new Error(`Failed to parse HEROKU_XP config: ${error.message}`)
        }
      }

      debug('HEROKU_XP config not found, returning empty config')
      // Return empty v2 config if HEROKU_XP doesn't exist
      return createEmptySimplifiedConfig()
    } catch (error: any) {
      debug('Error in getExperimentsConfig: %s', error.message)
      throw new Error(`Failed to read experiment configuration: ${error.message}`)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
