import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import * as https from 'https'
import * as http from 'http'
import createDebug from 'debug'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  SimplifiedRule,
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
  total2xx: number
  total3xx: number
  total4xx: number
  total5xx: number
  totalErrors: number
  timestamp: number
  smoothedRps?: number  // Exponential moving average of req/s
}

interface ExperimentMetrics {
  [key: string]: string
  experiment: string
  branch: string
  active: string
  route: string
  avgResponseTime: string
  errorRate: string
  throughput: string
  total2xx: string
  total3xx: string
  total4xx: string
  total5xx: string
}

export default class Watch extends Command {
  static description = 'Monitor experiment performance metrics in real-time'

  static examples = [
    `$ heroku xp:watch --app xp-demo-staging`,
    `$ heroku xp:watch -a my-app-staging`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }

  private previousCounters: Map<string, MetricCounters> = new Map()
  private isRunning = false
  private currentMetrics?: {
    appName: string
    results: ExperimentMetrics[]
    timestamp: Date
  }

  async run() {
    const {flags} = await this.parse(Watch)
    const appName = flags.app!

    debug('Starting watch for app: %s', appName)
    this.isRunning = true

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      debug('Received SIGINT, stopping watch')
      this.isRunning = false
      cli.action.stop('')
      this.log('\n\nStopping watch...')
      process.exit(0)
    })

    try {
      while (this.isRunning) {
        debug('Fetching metrics iteration for app: %s', appName)
        await this.fetchAndDisplayMetrics(appName)

        if (this.isRunning) {
          debug('Sleeping for 6 seconds before next update')
          // Wait 6 seconds before next update with countdown
          await this.sleepWithCountdown(6000)
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

      // Fetch parent app info to get web_url and app ID
      debug('Fetching parent app details for: %s', appName)
      const {body: parentApp} = await this.heroku.get<{web_url?: string; id?: string}>(`/apps/${appName}`)
      const parentWebUrl = parentApp.web_url
      const parentAppId = parentApp.id
      debug('Parent app web_url: %s, id: %s', parentWebUrl, parentAppId)

      if (!parentWebUrl) {
        throw new Error(`Parent app ${appName} has no web_url`)
      }

      if (!parentAppId) {
        throw new Error(`Parent app ${appName} has no id`)
      }

      debug('Fetching metrics for %d experiments using parent URL: %s', experimentsConfig.experiments.length, parentWebUrl)
      // Fetch metrics for each experiment using parent app URL
      const metricsPromises = experimentsConfig.experiments.map((exp, idx) => {
        debug('Experiment %d: appName=%s, branch=%s', idx + 1, exp.appName, exp.branch)
        return this.fetchExperimentMetrics(exp, parentWebUrl)
      })

      const metricsResults = await Promise.all(metricsPromises)
      debug('Successfully fetched metrics for %d experiments', metricsResults.length)

      // Fetch control (parent app) metrics
      debug('Fetching control metrics for parent app: %s (id: %s)', appName, parentAppId)
      const controlMetrics = await this.fetchControlMetrics(appName, parentAppId, parentWebUrl)
      metricsResults.push(controlMetrics)

      // Store metrics results for redrawing during countdown
      this.currentMetrics = {
        appName,
        results: metricsResults,
        timestamp: new Date(),
      }

      // Initial draw with full dots (6)
      this.redrawDisplay(6)
    } catch (error: any) {
      debug('Error in fetchAndDisplayMetrics: %s', error.message)
      console.clear()
      this.log(`\nError fetching metrics: ${error.message}`)
      this.log('Retrying in 6 seconds...\n')
    }
  }

  private async fetchControlMetrics(
    appName: string,
    appId: string,
    parentWebUrl: string
  ): Promise<ExperimentMetrics> {
    try {
      debug('fetchControlMetrics: appName=%s, appId=%s, parentWebUrl=%s', appName, appId, parentWebUrl)

      const metricsUrl = `${parentWebUrl}/.dyno-proxy/metrics/`
      debug('Fetching metrics from parent app URL: %s', metricsUrl)
      const metricsText = await this.fetchUrl(metricsUrl)
      debug('Successfully fetched metrics, response length: %d bytes', metricsText.length)

      // Try both router labels and combine metrics
      const routerLabel1 = 'app@file'  // Local app instance
      const routerLabel2 = `${appId}-control@file`  // Control router
      debug('Parsing Prometheus metrics for control router labels: %s, %s', routerLabel1, routerLabel2)

      const metrics1 = this.parsePrometheusMetrics(metricsText, routerLabel1)
      const metrics2 = this.parsePrometheusMetrics(metricsText, routerLabel2)

      // Combine metrics from both router labels
      const metrics = this.combineMetrics(metrics1, metrics2)

      if (!metrics) {
        debug('No metrics found for control router labels: %s, %s', routerLabel1, routerLabel2)
        return {
          experiment: appName,
          branch: '-',
          active: '- baseline',
          route: '-',
          avgResponseTime: '',
          errorRate: '',
          throughput: '',
          total2xx: '0',
          total3xx: '0',
          total4xx: '0',
          total5xx: '0',
        }
      }

      debug('Parsed control metrics: durationSum=%f, durationCount=%f, total200=%f, totalErrors=%f',
        metrics.durationSum, metrics.durationCount, metrics.total200, metrics.totalErrors)

      // Calculate average response time (just the number, no units)
      const avgResponseTime = metrics.durationCount > 0
        ? ((metrics.durationSum / metrics.durationCount) * 1000).toFixed(2)
        : ''
      debug('Calculated avgResponseTime: %s (durationSum=%f, durationCount=%f)',
        avgResponseTime, metrics.durationSum, metrics.durationCount)

      // Calculate error rate (just the number, no % sign)
      const totalRequests = metrics.total200 + metrics.totalErrors
      const errorRate = totalRequests > 0
        ? ((metrics.totalErrors / totalRequests) * 100).toFixed(2)
        : '0.00'
      debug('Calculated errorRate: %s (totalErrors=%f, totalRequests=%f)',
        errorRate, metrics.totalErrors, totalRequests)

      // Calculate throughput with exponential moving average for smoothing
      let throughput = ''
      const key = `${appId}-control`
      const previous = this.previousCounters.get(key)

      if (previous) {
        const timeDiff = (metrics.timestamp - previous.timestamp) / 1000 // seconds
        const requestDiff = (metrics.total2xx - previous.total2xx) +
                           (metrics.total3xx - previous.total3xx) +
                           (metrics.total4xx - previous.total4xx) +
                           (metrics.total5xx - previous.total5xx)

        debug('Calculating throughput: requestDiff=%f, timeDiff=%fs',
          requestDiff, timeDiff)

        if (timeDiff > 0) {
          const instantRps = requestDiff / timeDiff
          // Use exponential moving average (EMA) with alpha=0.3 for smoothing
          // smoothedRps = alpha * instantRps + (1 - alpha) * previousSmoothedRps
          const alpha = 0.3
          const smoothedRps = previous.smoothedRps !== undefined
            ? alpha * instantRps + (1 - alpha) * previous.smoothedRps
            : instantRps

          metrics.smoothedRps = smoothedRps
          throughput = smoothedRps >= 0 ? smoothedRps.toFixed(2) : '0.00'
          debug('Calculated throughput: instant=%f, smoothed=%s', instantRps, throughput)
        }
      } else {
        debug('No previous counters found for %s, throughput will be blank', key)
      }

      // Store current counters for next iteration
      this.previousCounters.set(key, metrics)
      debug('Stored current counters for next iteration')

      return {
        experiment: appName,
        branch: '-',
        active: '- baseline',
        route: '-',
        avgResponseTime,
        errorRate,
        throughput,
        total2xx: metrics.total2xx.toString(),
        total3xx: metrics.total3xx.toString(),
        total4xx: metrics.total4xx.toString(),
        total5xx: metrics.total5xx.toString(),
      }
    } catch (error: any) {
      debug('Error in fetchControlMetrics: %s', error.message)
      return {
        experiment: appName,
        branch: '-',
        active: '- baseline',
        route: '-',
        avgResponseTime: '',
        errorRate: '',
        throughput: '',
        total2xx: '0',
        total3xx: '0',
        total4xx: '0',
        total5xx: '0',
      }
    }
  }

  private async fetchExperimentMetrics(
    exp: SimplifiedExperimentEntry,
    parentWebUrl: string
  ): Promise<ExperimentMetrics> {
    try {
      const {appName, appID, branch, active, rules} = exp
      debug('fetchExperimentMetrics: appName=%s, appID=%s, branch=%s, parentWebUrl=%s', appName, appID, branch, parentWebUrl)

      // Format active status with mirror/live indicator
      const isMirror = rules && rules.length > 0 && rules[0].traffic === 'mirror'
      const mode = isMirror ? 'mirror' : 'live'
      const activeStatus = active === false ? '✗' : `✓ ${mode}`

      // Format route from rules
      const routeStr = this.formatRoute(rules)

      const metricsUrl = `${parentWebUrl}/.dyno-proxy/metrics/`
      debug('Fetching metrics from parent app URL: %s', metricsUrl)
      const metricsText = await this.fetchUrl(metricsUrl)
      debug('Successfully fetched metrics, response length: %d bytes', metricsText.length)

      const routerLabel = `${appID}-experiment@file`
      debug('Parsing Prometheus metrics for router label: %s', routerLabel)
      const metrics = this.parsePrometheusMetrics(metricsText, routerLabel)

      if (!metrics) {
        debug('No metrics found for router label: %s', routerLabel)
        return {
          experiment: appName,
          branch,
          active: activeStatus,
          route: routeStr,
          avgResponseTime: '',
          errorRate: '',
          throughput: '',
          total2xx: '0',
          total3xx: '0',
          total4xx: '0',
          total5xx: '0',
        }
      }

      debug('Parsed metrics: durationSum=%f, durationCount=%f, total200=%f, totalErrors=%f',
        metrics.durationSum, metrics.durationCount, metrics.total200, metrics.totalErrors)

      // Calculate average response time (just the number, no units)
      const avgResponseTime = metrics.durationCount > 0
        ? ((metrics.durationSum / metrics.durationCount) * 1000).toFixed(2)
        : ''
      debug('Calculated avgResponseTime: %s (durationSum=%f, durationCount=%f)',
        avgResponseTime, metrics.durationSum, metrics.durationCount)

      // Calculate error rate (just the number, no % sign)
      const totalRequests = metrics.total200 + metrics.totalErrors
      const errorRate = totalRequests > 0
        ? ((metrics.totalErrors / totalRequests) * 100).toFixed(2)
        : '0.00'
      debug('Calculated errorRate: %s (totalErrors=%f, totalRequests=%f)',
        errorRate, metrics.totalErrors, totalRequests)

      // Calculate throughput with exponential moving average for smoothing
      let throughput = ''
      const key = appID
      const previous = this.previousCounters.get(key)

      if (previous) {
        const timeDiff = (metrics.timestamp - previous.timestamp) / 1000 // seconds
        const requestDiff = (metrics.total2xx - previous.total2xx) +
                           (metrics.total3xx - previous.total3xx) +
                           (metrics.total4xx - previous.total4xx) +
                           (metrics.total5xx - previous.total5xx)

        debug('Calculating throughput: requestDiff=%f, timeDiff=%fs',
          requestDiff, timeDiff)

        if (timeDiff > 0) {
          const instantRps = requestDiff / timeDiff
          // Use exponential moving average (EMA) with alpha=0.3 for smoothing
          // smoothedRps = alpha * instantRps + (1 - alpha) * previousSmoothedRps
          const alpha = 0.3
          const smoothedRps = previous.smoothedRps !== undefined
            ? alpha * instantRps + (1 - alpha) * previous.smoothedRps
            : instantRps

          metrics.smoothedRps = smoothedRps
          throughput = smoothedRps >= 0 ? smoothedRps.toFixed(2) : '0.00'
          debug('Calculated throughput: instant=%f, smoothed=%s', instantRps, throughput)
        }
      } else {
        debug('No previous counters found for %s, throughput will be blank', key)
      }

      // Store current counters for next iteration
      this.previousCounters.set(key, metrics)
      debug('Stored current counters for next iteration')

      return {
        experiment: appName,
        branch,
        active: activeStatus,
        route: routeStr,
        avgResponseTime,
        errorRate,
        throughput,
        total2xx: metrics.total2xx.toString(),
        total3xx: metrics.total3xx.toString(),
        total4xx: metrics.total4xx.toString(),
        total5xx: metrics.total5xx.toString(),
      }
    } catch (error: any) {
      debug('Error in fetchExperimentMetrics: %s', error.message)
      const {appName, branch, active, rules} = exp
      const isMirror = rules && rules.length > 0 && rules[0].traffic === 'mirror'
      const mode = isMirror ? 'mirror' : 'live'
      return {
        experiment: appName,
        branch,
        active: active === false ? '✗' : `✓ ${mode}`,
        route: this.formatRoute(rules),
        avgResponseTime: 'Error',
        errorRate: 'Error',
        throughput: 'Error',
        total2xx: '0',
        total3xx: '0',
        total4xx: '0',
        total5xx: '0',
      }
    }
  }

  private combineMetrics(metrics1: MetricCounters | null, metrics2: MetricCounters | null): MetricCounters | null {
    if (!metrics1 && !metrics2) {
      return null
    }

    if (!metrics1) return metrics2
    if (!metrics2) return metrics1

    // Combine metrics by summing counters and averaging durations
    const totalRequests = (metrics1.total2xx + metrics1.total3xx + metrics1.total4xx + metrics1.total5xx) +
                         (metrics2.total2xx + metrics2.total3xx + metrics2.total4xx + metrics2.total5xx)

    return {
      durationSum: metrics1.durationSum + metrics2.durationSum,
      durationCount: metrics1.durationCount + metrics2.durationCount,
      total200: metrics1.total200 + metrics2.total200,
      total2xx: metrics1.total2xx + metrics2.total2xx,
      total3xx: metrics1.total3xx + metrics2.total3xx,
      total4xx: metrics1.total4xx + metrics2.total4xx,
      total5xx: metrics1.total5xx + metrics2.total5xx,
      totalErrors: metrics1.totalErrors + metrics2.totalErrors,
      timestamp: Math.max(metrics1.timestamp, metrics2.timestamp),
      smoothedRps: undefined, // Will be calculated fresh
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
      total2xx: 0,
      total3xx: 0,
      total4xx: 0,
      total5xx: 0,
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

      // For service metrics, check the 'service' label; for router metrics, check 'router' label
      // Service label matches router label directly (both use -experiment@file suffix)
      const isMatch = labels.router === routerLabel || labels.service === routerLabel

      if (!isMatch) {
        skippedWrongRouter++
        continue
      }

      matchedLines++
      debug('Matched metric line: %s=%f, labels=%s', metricName, value, labelsStr)

      // Extract relevant metrics
      // Use traefik_service metrics instead of traefik_router to get actual backend timing
      if (metricName === 'traefik_service_request_duration_seconds_sum') {
        metrics.durationSum = (metrics.durationSum || 0) + value
        debug('Found durationSum: %f, total now: %f', value, metrics.durationSum)
      } else if (metricName === 'traefik_service_request_duration_seconds_count') {
        metrics.durationCount = (metrics.durationCount || 0) + value
        debug('Found durationCount: %f, total now: %f', value, metrics.durationCount)
      } else if (metricName === 'traefik_service_requests_total') {
        if (labels.code === '200') {
          metrics.total200 = (metrics.total200 || 0) + value
          debug('Found total200: %f, total now: %f', value, metrics.total200)
        }

        // Categorize by status code family
        if (labels.code && labels.code.startsWith('2')) {
          metrics.total2xx = (metrics.total2xx || 0) + value
          debug('Found 2xx (code=%s): %f, total2xx now: %f', labels.code, value, metrics.total2xx)
        } else if (labels.code && labels.code.startsWith('3')) {
          metrics.total3xx = (metrics.total3xx || 0) + value
          debug('Found 3xx (code=%s): %f, total3xx now: %f', labels.code, value, metrics.total3xx)
        } else if (labels.code && labels.code.startsWith('4')) {
          metrics.total4xx = (metrics.total4xx || 0) + value
          metrics.totalErrors = (metrics.totalErrors || 0) + value
          debug('Found 4xx (code=%s): %f, total4xx now: %f', labels.code, value, metrics.total4xx)
        } else if (labels.code && labels.code.startsWith('5')) {
          metrics.total5xx = (metrics.total5xx || 0) + value
          metrics.totalErrors = (metrics.totalErrors || 0) + value
          debug('Found 5xx (code=%s): %f, total5xx now: %f', labels.code, value, metrics.total5xx)
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

    debug('Successfully parsed metrics: durationSum=%f, durationCount=%f, total200=%f, total2xx=%f, total3xx=%f, total4xx=%f, total5xx=%f, totalErrors=%f',
      metrics.durationSum, metrics.durationCount, metrics.total200, metrics.total2xx, metrics.total3xx, metrics.total4xx, metrics.total5xx, metrics.totalErrors)
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

  private formatRoute(rules: SimplifiedRule[]): string {
    if (!rules || rules.length === 0) {
      return '-'
    }

    const rule = rules[0]
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

  private redrawDisplay(dotsRemaining: number) {
    if (!this.currentMetrics) return

    const {appName, results, timestamp} = this.currentMetrics

    // Clear screen and redraw with updated dots
    console.clear()
    this.log(`\nExperiment Metrics - ${appName}`)
    this.log(`Last updated: ${timestamp.toLocaleTimeString()} ${'.'.repeat(dotsRemaining)}\n`)

    // Display table with columns: Active, Branch, Route, Avg ms, Error %, Req/s, 2xx, 3xx, 4xx, 5xx
    cli.table(results, {
      active: {
        header: 'Active',
        minWidth: 15,
      },
      branch: {
        header: 'Branch',
        minWidth: 20,
      },
      route: {
        header: 'Route',
        minWidth: 20,
      },
      avgResponseTime: {
        header: 'Avg ms',
        minWidth: 10,
      },
      errorRate: {
        header: 'Error %',
        minWidth: 10,
      },
      throughput: {
        header: 'Req/s',
        minWidth: 10,
      },
      total2xx: {
        header: '2xx',
        minWidth: 8,
      },
      total3xx: {
        header: '3xx',
        minWidth: 8,
      },
      total4xx: {
        header: '4xx',
        minWidth: 8,
      },
      total5xx: {
        header: '5xx',
        minWidth: 8,
      },
    })

    this.log('')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async sleepWithCountdown(ms: number): Promise<void> {
    const totalSeconds = Math.floor(ms / 1000)

    // Use cli.action spinner with "Press Ctrl+C to exit" text
    cli.action.start('Press Ctrl+C to exit')

    // Countdown: redraw display with decreasing dots every second
    for (let remaining = totalSeconds; remaining > 0; remaining--) {
      // Redraw the display with remaining dots
      this.redrawDisplay(remaining)

      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Check if we should stop early
      if (!this.isRunning) {
        cli.action.stop('')
        return
      }
    }

    // Stop spinner without showing "done" message
    cli.action.stop('')
  }
}
