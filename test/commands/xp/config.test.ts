import {expect, test} from '@oclif/test'

describe('xp:config', () => {
  test
    .stdout()
    .command(['xp:config', '--help'])
    .it('shows help', ctx => {
      expect(ctx.stdout).to.contain('Display HEROKU_XP configuration')
    })
})
