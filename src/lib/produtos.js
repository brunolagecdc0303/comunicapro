import { supabase } from './supabase'

// ============================================
// PRODUTOS CRIADOS PELO TIME (migration 017)
// ============================================

/** Produtos que o time criou na tela, além do catálogo fixo. */
export async function getProdutosPersonalizados(teamId) {
  const { data, error } = await supabase
    .from('produtos_personalizados')
    .select('*')
    .eq('team_id', teamId)
    .order('ordem')
    .order('created_at')
  if (error) throw error
  return data
}

export async function createProdutoPersonalizado(teamId, valores, userId) {
  const { data, error } = await supabase
    .from('produtos_personalizados')
    .insert({ team_id: teamId, ...valores, created_by: userId })
    .select().single()
  if (error) throw error
  return data
}

/** Some a coluna; os estágios já gravados ficam (recriar traz de volta). */
export async function deleteProdutoPersonalizado(id) {
  const { error } = await supabase.from('produtos_personalizados').delete().eq('id', id)
  if (error) throw error
}
