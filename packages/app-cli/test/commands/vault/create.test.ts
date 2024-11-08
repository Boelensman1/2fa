import { runCommand } from '@oclif/test'
import { expect } from 'chai'

describe('vault:create', () => {
  it('runs vault:create cmd', async () => {
    const { stdout } = await runCommand('vault:create')
    expect(stdout).to.contain('hello world')
  })

  it('runs vault:create --name oclif', async () => {
    const { stdout } = await runCommand('vault:create --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
