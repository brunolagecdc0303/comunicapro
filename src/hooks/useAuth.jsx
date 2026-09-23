import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [team, setTeam] = useState(null)
  const [ehAdmin, setEhAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadTeam(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) await loadTeam(session.user.id)
        else { setTeam(null); setLoading(false) }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function loadTeam(userId) {
    // Não busca wasender_api_key/claude_api_key aqui: essas chaves ficam restritas
    // à tela de Configurações, que as busca sob demanda (ver Config.jsx). Evita
    // manter segredos na memória/estado global do app em toda página.
    // maybeSingle: um usuário recém-criado ainda pode não ter time, e isso é
    // um estado normal — não um erro. A tela trata mostrando o aviso certo.
    const [{ data }, { data: admin }] = await Promise.all([
      supabase
        .from('team_members')
        .select('team_id, role, teams(id, name, settings)')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle(),
      supabase.from('super_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    ])
    setTeam(data ? { ...data.teams, role: data.role } : null)
    setEhAdmin(!!admin)
    setLoading(false)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, team, ehAdmin, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
