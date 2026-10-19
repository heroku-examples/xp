import * as sinon from 'sinon'
import {expect} from 'chai'
import {
  ExperimentsConfig,
  ExperimentEntry,
  ExperimentRule,
} from '../../src/types/experiment'

/**
 * Test helpers for Heroku XP plugin unit tests
 */

export {expect, sinon}

/**
 * Creates a mock Heroku API response
 */
export function createMockHerokuResponse(body: any, statusCode = 200) {
  return {
    body,
    statusCode,
    headers: {},
  }
}

/**
 * Creates a mock Heroku app object
 */
export function createMockApp(overrides: Partial<any> = {}): any {
  return {
    id: 'app-uuid-123',
    name: 'test-parent-app',
    region: {
      id: 'region-uuid',
      name: 'us',
    },
    stack: {
      id: 'stack-uuid',
      name: 'heroku-22',
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    web_url: 'https://test-parent-app.herokuapp.com',
    team: null,
    organization: null,
    ...overrides,
  }
}

/**
 * Creates a mock GitHub repo object
 */
export function createMockGitHubRepo(overrides: Partial<any> = {}): any {
  return {
    id: 123,
    repo: 'heroku/test-repo',
    ...overrides,
  }
}

/**
 * Creates a mock HEROKU_XP config (v2 simplified format)
 */
export function createMockExperimentsConfig(experiments: ExperimentEntry[] = []): ExperimentsConfig {
  return {
    version: 1,
    experiments,
  }
}

/**
 * Creates a mock experiment entry (v2 simplified format)
 */
export function createMockExperiment(branch: string, routeID: string, overrides: Partial<ExperimentEntry> = {}): ExperimentEntry {
  const defaultRule: ExperimentRule = {
    weight: 10,
    traffic: 'live',
    methods: 'GET',
  }

  return {
    appID: `app-uuid-${branch}`,
    routeID,
    branch,
    url: `https://github.com/heroku/test-repo/tree/${branch}`,
    rules: [defaultRule],
    active: true,
    ...overrides,
  }
}

/**
 * Creates a mock pipeline coupling
 */
export function createMockPipelineCoupling(overrides: Partial<any> = {}): any {
  return {
    id: 'coupling-uuid',
    app: {
      id: 'app-uuid',
    },
    pipeline: {
      id: 'pipeline-uuid',
      name: 'test-pipeline',
    },
    stage: 'production',
    ...overrides,
  }
}

/**
 * Creates a mock buildpack object
 */
export function createMockBuildpack(url: string, ordinal = 0): any {
  return {
    ordinal,
    buildpack: {
      url,
      name: url.split('/').pop() || 'buildpack',
    },
  }
}

/**
 * Mock config vars object
 */
export function createMockConfigVars(overrides: any = {}): any {
  return {
    NODE_ENV: 'production',
    PORT: '5000',
    ...overrides,
  }
}

/**
 * Validates HEROKU_XP config structure
 */
export function validateExperimentsConfig(config: ExperimentsConfig): void {
  expect(config).to.have.property('version', 1)
  expect(config).to.have.property('experiments')
  expect(config.experiments).to.be.an('array')
}

/**
 * Validates experiment object structure (v2 format)
 */
export function validateExperiment(experiment: ExperimentEntry): void {
  expect(experiment).to.have.property('appID')
  expect(experiment).to.have.property('routeID')
  expect(experiment).to.have.property('branch')
  expect(experiment).to.have.property('url')
  expect(experiment).to.have.property('rules')
  expect(experiment.rules).to.be.an('array')
}

/**
 * Waits for a promise to resolve (for async testing)
 */
export async function waitForPromise(ms = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
