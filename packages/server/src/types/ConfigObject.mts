import { z } from 'zod'

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
})

export type ConfigObject = z.infer<typeof ConfigObjectSchema>
export type DatabaseConnectionConfig = ConfigObject['database']['connection']
