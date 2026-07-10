import {expect} from 'chai'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  validateWeights,
} from '../../src/types/experiment'

describe('validateWeights', () => {
  // Helper to create a minimal experiment
  function createExperiment(overrides: Partial<SimplifiedExperimentEntry>): SimplifiedExperimentEntry {
    return {
      appName: 'test-exp',
      appID: 'exp-123',
      parentApp: 'test-app',
      branch: 'test-branch',
      version: 1,
      repo: 'test/repo',
      url: 'https://test.herokuapp.com',
      rules: [],
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  describe('basic weight validation', () => {
    it('allows experiments with total weight exactly 100%', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows experiments with total weight less than 100%', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 30}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 40}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('rejects experiments with total weight exceeding 100%', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 60}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.throw(/110%/)
    })

    it('allows experiment with weight 0', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 0}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('treats undefined weight as 0', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET'}], // no weight
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different paths', () => {
    it('allows experiments with different paths to have independent weights', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api/v2', method: 'GET', weight: 50}],
          }),
        ],
      }

      // Total is 100%, but they're different paths, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows three experiments with different paths each at 50%', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api/v2', method: 'GET', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-3',
            rules: [{path: '/admin', method: 'GET', weight: 50}],
          }),
        ],
      }

      // Total is 150%, but all different paths, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different query parameters', () => {
    it('allows experiments with different query params to have independent weights', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', query: 'version: 1', method: 'GET', weight: 60}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', query: 'version: 2', method: 'GET', weight: 60}],
          }),
        ],
      }

      // Total is 120%, but different queries, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different headers', () => {
    it('allows experiments with different headers to have independent weights', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', header: 'X-Beta: true', method: 'GET', weight: 70}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', header: 'X-Beta: false', method: 'GET', weight: 70}],
          }),
        ],
      }

      // Total is 140%, but different headers, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('routing parameter grouping - different methods', () => {
    it('allows experiments with different methods to have independent weights', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'POST', weight: 50}],
          }),
        ],
      }

      // Total is 100%, but different methods, so should be allowed
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows GET and POST to each have 100% weight on same path', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 100}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'POST', weight: 100}],
          }),
        ],
      }

      // Different methods = different routing groups
      expect(() => validateWeights(config)).to.not.throw()
    })
  })

  describe('matching routing parameters', () => {
    it('rejects experiments with identical routing when total exceeds 100%', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{
              path: '/api',
              query: 'beta: true',
              header: 'X-Test: yes',
              method: 'GET',
              weight: 60,
            }],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{
              path: '/api',
              query: 'beta: true',
              header: 'X-Test: yes',
              method: 'GET',
              weight: 50,
            }],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.throw(/110%/)
    })

    it('provides helpful error message with routing details', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api/users', method: 'POST', weight: 70}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api/users', method: 'POST', weight: 40}],
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
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
            active: true,
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 60}],
            active: false, // inactive
          }),
        ],
      }

      // Only exp-1 (50%) counts, exp-2 is inactive
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('treats undefined active as true (active)', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 60}],
            // active is undefined (defaults to true)
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 50}],
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
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50, mirror: true}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 60}],
          }),
        ],
      }

      // exp-1 is mirror mode, so only exp-2 (60%) counts
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows multiple mirror experiments without weight limits', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 100, mirror: true}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 100, mirror: true}],
          }),
          createExperiment({
            appName: 'exp-3',
            rules: [{path: '/api', method: 'GET', weight: 100, mirror: true}],
          }),
        ],
      }

      // All are mirror mode, none count toward weight limit
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('validates non-mirror experiments even when mirror experiments exist', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 100, mirror: true}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 60}],
          }),
          createExperiment({
            appName: 'exp-3',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
        ],
      }

      // exp-1 is mirror (ignored), exp-2 + exp-3 = 110%
      expect(() => validateWeights(config)).to.throw(/110%/)
    })
  })

  describe('edge cases', () => {
    it('allows empty experiments array', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows experiments with no rules', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('allows experiments with undefined rules array', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: undefined as any,
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('handles experiments with all undefined routing parameters', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{weight: 50}], // no path, query, header, method
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{weight: 50}], // no path, query, header, method
          }),
        ],
      }

      // Both have same routing signature (all null), so they're grouped
      expect(() => validateWeights(config)).to.not.throw()
    })

    it('treats null and undefined routing params as equivalent', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: undefined, method: 'GET', weight: 60}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{method: 'GET', weight: 50}], // path implicitly undefined
          }),
        ],
      }

      // Both have path=undefined, method=GET, so same group (110%)
      expect(() => validateWeights(config)).to.throw(/110%/)
    })
  })

  describe('complex multi-experiment scenarios', () => {
    it('validates multiple routing groups independently', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          // Group 1: /api GET - 100% (valid)
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 60}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 40}],
          }),
          // Group 2: /api POST - 90% (valid)
          createExperiment({
            appName: 'exp-3',
            rules: [{path: '/api', method: 'POST', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-4',
            rules: [{path: '/api', method: 'POST', weight: 40}],
          }),
          // Group 3: /admin GET - 100% (valid)
          createExperiment({
            appName: 'exp-5',
            rules: [{path: '/admin', method: 'GET', weight: 100}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.not.throw()
    })

    it('rejects if any routing group exceeds 100%', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          // Group 1: /api GET - 90% (valid)
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 40}],
          }),
          // Group 2: /api POST - 110% (INVALID)
          createExperiment({
            appName: 'exp-3',
            rules: [{path: '/api', method: 'POST', weight: 60}],
          }),
          createExperiment({
            appName: 'exp-4',
            rules: [{path: '/api', method: 'POST', weight: 50}],
          }),
        ],
      }

      expect(() => validateWeights(config)).to.throw(/110%/)
    })

    it('handles mix of active, inactive, and mirror experiments', () => {
      const config: SimplifiedExperimentsConfig = {
        version: 2,
        experiments: [
          createExperiment({
            appName: 'exp-1',
            rules: [{path: '/api', method: 'GET', weight: 50}],
            active: true,
          }),
          createExperiment({
            appName: 'exp-2',
            rules: [{path: '/api', method: 'GET', weight: 60}],
            active: false, // inactive - should be ignored
          }),
          createExperiment({
            appName: 'exp-3',
            rules: [{path: '/api', method: 'GET', weight: 40, mirror: true}],
            active: true, // mirror - should be ignored
          }),
          createExperiment({
            appName: 'exp-4',
            rules: [{path: '/api', method: 'GET', weight: 30}],
            active: true,
          }),
        ],
      }

      // Only exp-1 (50%) and exp-4 (30%) count = 80%
      expect(() => validateWeights(config)).to.not.throw()
    })
  })
})
