/**
 * Test helpers for xp command tests
 */

export function createMockExperimentConfig(overrides?: any) {
  return {
    version: 1,
    experiments: [
      {
        appID: 'exp-123-app-id',
        routeID: 'exp-123',
        branch: 'feature-a',
        url: 'https://test-exp-app.herokuapp.com',
        rules: [],
        ...overrides,
      },
    ],
  }
}

export function createMockPrometheusMetrics(options?: {
  route?: string
  sumValue?: number
  countValue?: number
  totalRequests?: number
  errorRequests?: number
}) {
  const {
    route = '/api',
    sumValue = 125.5,
    countValue = 100,
    totalRequests = 1000,
    errorRequests = 0,
  } = options || {}

  let metrics = `
# HELP http_request_duration_seconds HTTP request latency
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_sum{route="${route}"} ${sumValue}
http_request_duration_seconds_count{route="${route}"} ${countValue}

# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{route="${route}",status="200"} ${totalRequests - errorRequests}
`

  if (errorRequests > 0) {
    metrics += `http_requests_total{route="${route}",status="500"} ${errorRequests}\n`
  }

  return metrics
}

export function createMockConfigVars(config: any) {
  return {
    HEROKU_XP: JSON.stringify(config),
  }
}
