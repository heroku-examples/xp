import {expect, test} from '@oclif/test'

describe('xp:start', () => {
  test
    .stdout()
    .command(['xp:start', '--help'])
    .it('shows help', ctx => {
      expect(ctx.stdout).to.contain('Start (reactivate) a stopped experiment')
    })
})
