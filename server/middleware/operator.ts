import { needsOperator, requireOperator } from '../utils/operator'

/** Guards every /api write that spends money or changes state (the list and its exceptions: needsOperator). */
export default defineEventHandler(async (event) => {
  if (needsOperator(event.method, getRequestURL(event).pathname)) {
    await requireOperator(event)
  }
})
