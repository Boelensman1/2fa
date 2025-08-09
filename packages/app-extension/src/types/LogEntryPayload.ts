interface LogEntryPayload {
  identifier: string
  level: number
  msg: string
  data: string
  ts: number
  color?: string
}
export default LogEntryPayload
