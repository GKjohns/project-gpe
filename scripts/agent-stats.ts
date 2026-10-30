// npm run agent:stats [-- --days 7]: who is calling the agent API, from agent_requests (server/utils/agentStats.ts).
import { agentRequestStats, formatAgentStats } from '../server/utils/agentStats'
import { openDb } from './db'

const i = process.argv.indexOf('--days')
const days = i >= 0 ? Number(process.argv[i + 1]) || 30 : 30

const { db, close } = await openDb()
try {
  console.log(formatAgentStats(await agentRequestStats(db, { days })))
} finally {
  await close()
}
