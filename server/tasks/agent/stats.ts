// npm run agent:stats [-- --payload.days=7]: who is calling the agent API, from agent_requests. Dev server up.
import { agentRequestStats, formatAgentStats } from '../../utils/agentStats'

export default defineTask({
  meta: { name: 'agent:stats', description: 'Agent API usage readout from agent_requests (payload days, default 30)' },
  async run({ payload }) {
    const days = Number(payload.days) || 30
    return { result: formatAgentStats(await agentRequestStats({ days })) }
  }
})
