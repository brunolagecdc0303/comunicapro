// Helper compartilhado entre Edge Functions: nunca confiar num teamId vindo
// do corpo da requisição sem confirmar que quem chamou pertence a esse time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export function extractBearerToken(req: Request): string {
  const header = req.headers.get('Authorization') || ''
  return header.replace(/^Bearer\s+/i, '')
}

export function isServiceRoleToken(token: string): boolean {
  return !!token && token === SERVICE_ROLE_KEY
}

// Confirma que o dono do token (usuário autenticado) é membro do time informado.
export async function callerBelongsToTeam(callerToken: string, teamId: string): Promise<boolean> {
  if (!callerToken || !teamId) return false

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  })
  const { data: { user }, error } = await authClient.auth.getUser()
  if (error || !user) return false

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: membership } = await admin
    .from('team_members')
    .select('team_id')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle()

  return !!membership
}
