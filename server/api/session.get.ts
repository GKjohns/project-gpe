import { authMode, isOperator } from '../utils/operator'

/** `{ operator, auth }`: whether this browser may use the operator controls, and how auth is configured. */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return { operator: await isOperator(event), auth: authMode() }
})
