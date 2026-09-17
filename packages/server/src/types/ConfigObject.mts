import { z } from 'zod'
import { SERVER_SECRET_MIN_LENGTH } from 'favalib/protocol/connectAuth'

export const ConfigObjectSchema = z.object({
  database: z.object({
    connection: z.object({
      host: z.string(),
      port: z.number(),
      user: z.string(),
      password: z.string(),
      database: z.string(),
    }),
  }),
  sync: z.object({
    /**
     * The static secret a client must prove before the server will act on
     * anything it sends.
     *
     * REQUIRED, and the cost of that is worth stating: `knexfile.ts` imports
     * this config at module load, so a deployment missing this key does not get
     * a server with the gate switched off -- it gets no server, no migrations
     * and no test run. That is the intended failure. A gate that silently does
     * nothing when someone forgets to configure it is worse than no gate, since
     * it is indistinguishable from a working one.
     *
     * Make one with `openssl rand -base64 32`. It is not device
     * authentication: every device of a deployment holds the same value, so it
     * says who may open a socket and nothing about who is on the other end. See
     * key-hierarchy-review/16-server-authentication.md.
     */
    sharedSecret: z.string().min(SERVER_SECRET_MIN_LENGTH),
  }),
})

export type ConfigObject = z.infer<typeof ConfigObjectSchema>
export type DatabaseConnectionConfig = ConfigObject['database']['connection']
