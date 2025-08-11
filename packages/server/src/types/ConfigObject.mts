export interface DatabaseConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export interface ConfigObject {
  database: {
    connection: DatabaseConnectionConfig
  }
}
