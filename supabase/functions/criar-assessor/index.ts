// Supabase Edge Function: criar-assessor
//
// Cria o usuário de um assessor parceiro, o time dele e o vínculo — numa
// operação só. Precisa da Service Role (criar usuário é privilégio de admin),
// e é exatamente por isso que a autorização aqui é a parte que importa:
// quem chama tem que estar em super_admins.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractBearerToken } from '../_shared/auth.ts'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })

  try {
    const token = extractBearerToken(req)
    if (!token) return json({ error: 'Não autorizado' }, 401)

    // 1) Quem é quem chamou
    const comoUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: erroUser } = await comoUsuario.auth.getUser()
    if (erroUser || !user) return json({ error: 'Não autorizado' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 2) É super admin? A checagem usa a Service Role de propósito: não pode
    //    depender de uma policy que o próprio chamador poderia influenciar.
    const { data: ehAdmin } = await admin
      .from('super_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    if (!ehAdmin) return json({ error: 'Apenas administradores podem criar assessores' }, 403)

    const { email, senha, nomeDoTime } = await req.json()
    if (!email || !senha || !nomeDoTime) {
      return json({ error: 'Informe email, senha e nome do time' }, 400)
    }
    if (String(senha).length < 8) {
      return json({ error: 'A senha precisa ter ao menos 8 caracteres' }, 400)
    }

    // 3) Cria o usuário já confirmado (o assessor recebe email e senha do Bruno,
    //    não há fluxo de convite por email configurado no projeto).
    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    })
    if (erroCriar) {
      const duplicado = /already|exists|registered/i.test(erroCriar.message)
      return json({ error: duplicado ? 'Já existe usuário com esse email.' : erroCriar.message }, 400)
    }

    const novoUserId = criado.user.id

    // 4) Time próprio + vínculo como owner. Se algo falhar daqui pra frente,
    //    o usuário criado ficaria órfão — então desfaz.
    try {
      const { data: time, error: erroTime } = await admin
        .from('teams')
        .insert({ name: nomeDoTime, owner_id: novoUserId })
        .select().single()
      if (erroTime) throw erroTime

      const { error: erroVinculo } = await admin
        .from('team_members')
        .insert({ team_id: time.id, user_id: novoUserId, role: 'owner' })
      if (erroVinculo) throw erroVinculo

      return json({ ok: true, userId: novoUserId, teamId: time.id, email })
    } catch (err) {
      await admin.auth.admin.deleteUser(novoUserId).catch(() => {})
      return json({ error: `Falha ao montar o time: ${err.message}` }, 500)
    }
  } catch (error) {
    return json({ error: error.message }, 500)
  }
})
