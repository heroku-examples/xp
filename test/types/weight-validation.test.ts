import {expect} from 'chai'
import {
  ExperimentsConfig,
  ExperimentEntry,
  validateWeights,
} from '../../src/types/experiment'

describe('validateWeights', () => {
  // Helper to create a minimal experiment
  function createExperiment(overrides: Partial<ExperimentEntry>): ExperimentEntry {
    return {
      appID: 'exp-123-app-id',
      routeID: 'exp-123',
      branch: 'test-branch',
      url: 'https://test.herokuapp.com',
      rules: [],
      active: true,
      ...overrides,
    }
  }

  describe('basic weight validation', () => {
    it('allows experiments with total weight exactly 100%', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows experiments with total weight less than 100%', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 30}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 40}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('rejects experiments with total weight exceeding 100%', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.throw(/110%/)
    })

    it('allows experiment with weight 0', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 0}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('treats undefined weight as 0', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET'}], // no weight
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different paths', () => {
    it('allows experiments with different paths to have independent weights', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api/v2', methods: 'GET', weight: 50}],
          }),
        ],
      }

      // Total is 100%, but they're different paths, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows three experiments with different paths each at 50%', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api/v2', methods: 'GET', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-3-app-id',
            routeID: 'exp-3',
            rules: [{path: '/admin', methods: 'GET', weight: 50}],
          }),
        ],
      }

      // Total is 150%, but all different paths, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different query parameters', () => {
    it('allows experiments with different query params to have independent weights', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', query: 'version: 1', methods: 'GET', weight: 60}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', query: 'version: 2', methods: 'GET', weight: 60}],
          }),
        ],
      }

      // Total is 120%, but different queries, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different headers', () => {
    it('allows experiments with different headers to have independent weights', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', header: 'X-Beta: true', methods: 'GET', weight: 70}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', header: 'X-Beta: false', methods: 'GET', weight: 70}],
          }),
        ],
      }

      // Total is 140%, but different headers, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different methods', () => {
    it('allows experiments with different methods to have independent weights', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'POST', weight: 50}],
          }),
        ],
      }

      // Total is 100%, but different methods, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows GET and POST to each have 100% weight on same path', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 100}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'POST', weight: 100}],
          }),
        ],
      }

      // Different methods = different routing groups
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('matching routing parameters', () => {
    it('rejects experiments with identical routing when total exceeds 100%', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{
              path: '/api',
              query: 'beta: true',
              header: 'X-Test: yes',
              methods: 'GET',
              weight: 60,
            }],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{
              path: '/api',
              query: 'beta: true',
              header: 'X-Test: yes',
              methods: 'GET',
              weight: 50,
            }],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.throw(/110%/)
    })

    it('provides helpful error message with routing details', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api/users', methods: 'POST', weight: 70}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api/users', methods: 'POST', weight: 40}],
          }),
        ],
      }

      try {
        validateWeights(config)
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('path: /api/users')
        expect(error.message).to.include('method: POST')
        expect(error.message).to.include('110%')
      }
    })
  })

  describe('active/inactive filtering', () => {
    it('ignores inactive experiments when calculating weights', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
            active: true,
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
            active: false, // inactive
          }),
        ],
      }

      // Only exp-1 (50%) counts, exp-2 is inactive
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('treats undefined active as true (active)', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
            // active is undefined (defaults to true)
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
            active: true,
          }),
        ],
      }

      // Both active (60 + 50 = 110%)
      expect(() => validateWeights(config)).to.throw(/110%/)
    })
  })

  describe('mirror mode experiments', () => {
    it('excludes mirror experiments from weight validation', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50, traffic: 'mirror'}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
          }),
        ],
      }

      // exp-1 is mirror mode, so only exp-2 (60%) counts
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows multiple mirror experiments without weight limits', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 100, traffic: 'mirror'}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 100, traffic: 'mirror'}],
          }),
          createExperiment({
            appID: 'exp-3-app-id',
            routeID: 'exp-3',
            rules: [{path: '/api', methods: 'GET', weight: 100, traffic: 'mirror'}],
          }),
        ],
      }

      // All are mirror mode, none count toward weight limit
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('validates non-mirror experiments even when mirror experiments exist', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 100, traffic: 'mirror'}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
          }),
          createExperiment({
            appID: 'exp-3-app-id',
            routeID: 'exp-3',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
        ],
      }

      // exp-1 is mirror (ignored), exp-2 + exp-3 = 110%
      expect(() => validateWeights(config)).to.throw(/110%/)
    })
  })

  describe('edge cases', () => {
    it('allows empty experiments array', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows experiments with no rules', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows experiments with undefined rules array', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: undefined as any,
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('handles experiments with all undefined routing parameters', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{weight: 50}], // no path, query, header, method
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{weight: 50}], // no path, query, header, method
          }),
        ],
      }

      // Both have same routing signature (all null), so they're grouped
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('treats null and undefined routing params as equivalent', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: undefined, methods: 'GET', weight: 60}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{methods: 'GET', weight: 50}], // path implicitly undefined
          }),
        ],
      }

      // Both have path=undefined, method=GET, so same group (110%)
      expect(() => validateWeights(config)).to.throw(/110%/)
    })
  })

  describe('complex multi-experiment scenarios', () => {
    it('validates multiple routing groups independently', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          // Group 1: /api GET - 100% (valid)
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 40}],
          }),
          // Group 2: /api POST - 90% (valid)
          createExperiment({
            appID: 'exp-3-app-id',
            routeID: 'exp-3',
            rules: [{path: '/api', methods: 'POST', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-4-app-id',
            routeID: 'exp-4',
            rules: [{path: '/api', methods: 'POST', weight: 40}],
          }),
          // Group 3: /admin GET - 100% (valid)
          createExperiment({
            appID: 'exp-5-app-id',
            routeID: 'exp-5',
            rules: [{path: '/admin', methods: 'GET', weight: 100}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('rejects if any routing group exceeds 100%', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          // Group 1: /api GET - 90% (valid)
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 40}],
          }),
          // Group 2: /api POST - 110% (INVALID)
          createExperiment({
            appID: 'exp-3-app-id',
            routeID: 'exp-3',
            rules: [{path: '/api', methods: 'POST', weight: 60}],
          }),
          createExperiment({
            appID: 'exp-4-app-id',
            routeID: 'exp-4',
            rules: [{path: '/api', methods: 'POST', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.throw(/110%/)
    })

    it('handles mix of active, inactive, and mirror experiments', () => {
      const config: ExperimentsConfig = {
        version: 1,
        experiments: [
          createExperiment({
            appID: 'exp-1-app-id',
            routeID: 'exp-1',
            rules: [{path: '/api', methods: 'GET', weight: 50}],
            active: true,
          }),
          createExperiment({
            appID: 'exp-2-app-id',
            routeID: 'exp-2',
            rules: [{path: '/api', methods: 'GET', weight: 60}],
            active: false, // inactive - should be ignored
          }),
          createExperiment({
            appID: 'exp-3-app-id',
            routeID: 'exp-3',
            rules: [{path: '/api', methods: 'GET', weight: 40, traffic: 'mirror'}],
            active: true, // mirror - should be ignored
          }),
          createExperiment({
            appID: 'exp-4-app-id',
            routeID: 'exp-4',
            rules: [{path: '/api', methods: 'GET', weight: 30}],
            active: true,
          }),
        ],
      }

      // Only exp-1 (50%) and exp-4 (30%) count = 80%
      expect(() => validateWeights(config)).to.not.throw()
    })
  })
})
