import { authMode, signOut } from '../../utils/operator'

export default defineEventHandler(async (event) => {
  if (authMode() === 'token') {
    await signOut(event)
  }
  return { operator: authMode() === 'open' }
})
