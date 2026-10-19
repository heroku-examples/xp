import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Update from '../../../src/commands/xp/update'
import {
  createMockExperiment,
  createMockExperimentsConfig,
  createMockConfigVars,
} from '../../helpers/setup'
import {ExperimentEntry, ExperimentsConfig} from '../../../src/types/experiment'

describe('xp:update', () => {
  let herokuGetStub: sinon.SinonStub
  let herokuPatchStub: sinon.SinonStub

  beforeEach(() => {
    herokuGetStub = sinon.stub()
    herokuPatchStub = sinon.stub()
  })

  function givenExperiments(experiments: ExperimentEntry[]) {
    herokuGetStub
      .withArgs('/apps/test-parent-app/config-vars')
      .resolves({body: createMockConfigVars({HEROKU_XP: JSON.stringify(createMockExperimentsConfig(experiments))})})
    herokuPatchStub.resolves({body: {}})
  }

  function patchedConfig(): ExperimentsConfig {
    const call = herokuPatchStub.getCalls().find(c => c.args[1]?.body?.HEROKU_XP)
    expect(call).to.exist
    return JSON.parse(call!.args[1].body.HEROKU_XP)
  }

  const withStubs = () => test.stub(Update.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))

  test
    .command(['xp:update', '--app', 'test-parent-app'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Missing required flag')
    })
    .it('requires --branch')

  withStubs()
    .do(() => givenExperiments([
      createMockExperiment('feature-xyz', 'exp-app', {
        rules: [{weight: 10, traffic: 'live', methods: 'GET', path: '/api'}],
      }),
    ]))
    .stdout()
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--weight', '25'])
    .it('replaces the rule: flags not given are cleared', (ctx: any) => {
      expect(ctx.stdout).to.contain('Updated experiment')

      const experiment = patchedConfig().experiments[0]
      expect(experiment.rules[0]).to.deep.equal({weight: 25, traffic: 'mirror'})
    })

  withStubs()
    .do(() => givenExperiments([
      createMockExperiment('feature-xyz', 'exp-app', {
        rules: [{weight: 10, traffic: 'mirror', methods: 'GET'}],
      }),
    ]))
    .stdout()
    .command([
      'xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz',
      '--traffic', 'live', '--path', '/a', '--query', 'xp=one', '--header', 'x-xp=two',
    ])
    .it('sets traffic, path, query and header', () => {
      const rule = patchedConfig().experiments[0].rules[0]
      expect(rule.traffic).to.equal('live')
      expect(rule.path).to.equal('/a')
      expect(rule.query).to.equal('xp: one')
      expect(rule.header).to.equal('x-xp: two')
      expect(rule).to.not.have.property('weight')
    })

  withStubs()
    .do(() => givenExperiments([
      createMockExperiment('one', 'exp-one'),
      createMockExperiment('two', 'exp-two'),
    ]))
    .stdout()
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'two', '--weight', '30'])
    .it('only updates the requested branch', () => {
      const [one, two] = patchedConfig().experiments
      expect(one.rules[0].weight).to.equal(10)
      expect(two.rules[0].weight).to.equal(30)
    })

  withStubs()
    .do(() => givenExperiments([
      createMockExperiment('feature-xyz', 'exp-app', {
        rules: [{weight: 10, traffic: 'live', methods: 'POST', path: '/api'}],
      }),
    ]))
    .stdout()
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '-q', 'x=1'])
    .it('does not carry over weight, path or traffic when only --query is given', () => {
      expect(patchedConfig().experiments[0].rules[0]).to.deep.equal({traffic: 'mirror', query: 'x: 1'})
    })

  withStubs()
    .do(() => givenExperiments([createMockExperiment('feature-xyz', 'exp-app')]))
    .stdout()
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--methods', 'get, post,PUT'])
    .it('sets methods from a comma-separated value', () => {
      expect(patchedConfig().experiments[0].rules[0].methods).to.equal('GET,POST,PUT')
    })

  withStubs()
    .do(() => givenExperiments([
      createMockExperiment('feature-xyz', 'exp-app', {
        rules: [{weight: 10, traffic: 'live', methods: 'POST'}],
      }),
    ]))
    .stdout()
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--weight', '20'])
    .it('clears the method when --methods is not given', () => {
      expect(patchedConfig().experiments[0].rules[0].methods).to.equal(undefined)
    })

  withStubs()
    .do(() => givenExperiments([createMockExperiment('feature-xyz', 'exp-app')]))
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--methods', 'FETCH'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Invalid method "FETCH"')
    })
    .it('rejects an unknown method')

  withStubs()
    .do(() => givenExperiments([createMockExperiment('feature-xyz', 'exp-app')]))
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--weight', '101'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Weight must be between 0 and 100')
    })
    .it('rejects a weight over 100', () => {
      expect(herokuPatchStub.called).to.be.false
    })

  withStubs()
    .do(() => givenExperiments([createMockExperiment('feature-xyz', 'exp-app')]))
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--query', 'novalue'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Invalid query parameter format')
    })
    .it('rejects a query without key=value')

  withStubs()
    .do(() => givenExperiments([createMockExperiment('feature-xyz', 'exp-app')]))
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'bad branch!', '--weight', '5'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Branch name contains invalid characters')
    })
    .it('rejects an invalid branch name')

  withStubs()
    .do(() => givenExperiments([createMockExperiment('other', 'exp-app')]))
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--weight', '5'])
    .catch((error: Error) => {
      expect(error.message).to.contain('No experiment found for branch "feature-xyz"')
    })
    .it('fails when the experiment does not exist')

  withStubs()
    .do(() => {
      herokuGetStub.resolves({body: createMockConfigVars()})
    })
    .command(['xp:update', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--weight', '5'])
    .catch((error: Error) => {
      expect(error.message).to.contain('No experiments configured')
    })
    .it('fails when HEROKU_XP is not set')
})
