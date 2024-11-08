import { runCommand } from '@oclif/test'
import { expect } from 'chai'

describe('entries:add', () => {
  it('runs entries:add cmd', async () => {
    const { stdout } = await runCommand('entries:add')
    expect(stdout).to.contain('hello world')
  })

  it('runs entries:add --name oclif', async () => {
    const { stdout } = await runCommand('entries:add --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
