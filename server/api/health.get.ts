import { appliedMigrations, dbDriver, useDb } from '../db'

export default defineEventHandler(async () => {
  const db = await useDb()
  return {
    db: dbDriver(),
    migrations: await appliedMigrations(db),
    gateway: Boolean(process.env.AI_GATEWAY_API_KEY)
  }
})
