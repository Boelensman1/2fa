import { execSync } from 'child_process'

/**
 * Sets up the test environment by running database migrations
 */
export const setup = () => {
  execSync(
    "NODE_ENV=test NODE_OPTIONS='--import tsx/esm' npx --no-install knex migrate:latest",
    {
      cwd: process.cwd(),
    },
  )
}

/**
 * Tears down the test environment by rolling back database migrations
 */
export const teardown = () => {
  execSync(
    "NODE_ENV=test NODE_OPTIONS='--import tsx/esm' npx --no-install knex migrate:rollback --all",
    {
      cwd: process.cwd(),
    },
  )
}
