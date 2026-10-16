import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Config from '../../../src/commands/xp/config'
import {
  createMockExperiment,
  createMockExperimentsConfig,
  createMockConfigVars,
} from '../../helpers/setup'

describe('xp:config', () => {
  let herokuGetStub: sinon.SinonStub

  beforeEach(() => {
    herokuGetStub = sinon.stub()
  })

  test
    .command(['xp:config'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Missing required flag')
    })
    .it('requires --app flag')

  test
    .stub(Config.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub})))
    .do(() => {
      const config = createMockExperimentsConfig([createMockExperiment('feature-xyz', 'exp-app')])
      herokuGetStub
        .withArgs('/apps/test-parent-app/config-vars')
        .resolves({body: createMockConfigVars({HEROKU_XP: JSON.stringify(config)})})
    })
    .stdout()
    .command(['xp:config', '--app', 'test-parent-app'])
    .it('pretty-prints the HEROKU_XP config', (ctx: any) => {
      const printed = JSON.parse(ctx.stdout)
      expect(printed.version).to.equal(1)
      expect(printed.experiments[0].branch).to.equal('feature-xyz')
      expect(ctx.stdout).to.contain('\n  "experiments"')
    })

  test
    .stub(Config.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub})))
    .do(() => {
      herokuGetStub
        .withArgs('/apps/test-parent-app/config-vars')
        .resolves({body: createMockConfigVars({HEROKU_XP: 'not json'})})
    })
    .stdout()
    .command(['xp:config', '--app', 'test-parent-app'])
    .it('prints the raw value when it is not valid JSON', (ctx: any) => {
      expect(ctx.stdout).to.equal('not json\n')
    })

  test
    .stub(Config.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub})))
    .do(() => {
      herokuGetStub
        .withArgs('/apps/test-parent-app/config-vars')
        .resolves({body: createMockConfigVars()})
    })
    .stdout()
    .command(['xp:config', '--app', 'test-parent-app'])
    .it('explains when HEROKU_XP is not set', (ctx: any) => {
      expect(ctx.stdout).to.contain('No HEROKU_XP configuration found')
      expect(ctx.stdout).to.contain('heroku xp:create')
    })

  test
    .stub(Config.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub})))
    .do(() => {
      herokuGetStub.rejects(new Error('boom'))
    })
    .command(['xp:config', '--app', 'test-parent-app'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Failed to fetch config: boom')
    })
    .it('fails when the config vars cannot be fetched')
})
