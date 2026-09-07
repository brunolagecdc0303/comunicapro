// Supabase Edge Function: cleanup-pdfs
// Apaga PDFs com mais de 7 dias: o arquivo no Storage (bucket "pdfs")
// e o registro correspondente em pdf_library. Chamada diariamente pelo pg_cron
// (ver migration 005_private_pdfs_cleanup.sql).
//
// A remoção passa pela Storage API (supabase.storage...remove), não por SQL direto,
// porque apagar a linha em storage.objects sozinha não libera o arquivo no bucket.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractBearerToken, isServiceRoleToken } from '../_shared/auth.ts'

const RETENTION_DAYS = 7

Deno.serve(async (req) => {
  // Só o cron (usando a Service Role Key) pode disparar a limpeza.
  if (!isServiceRoleToken(extractBearerToken(req))) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data: old, error } = await supabase
      .from('pdf_library')
      .select('id, storage_path, file_url')
      .lt('created_at', cutoff)

    if (error) throw error

    if (!old || old.length === 0) {
      return new Response(JSON.stringify({ deleted: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const paths = old.map(p => p.storage_path || pathFromLegacyUrl(p.file_url)).filter(Boolean) as string[]

    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage.from('pdfs').remove(paths)
      // Não interrompe a limpeza do banco por causa de um arquivo que já não existia no Storage
      if (removeError) console.error('Erro ao remover arquivos do Storage:', removeError.message)
    }

    const ids = old.map(p => p.id)
    const { error: deleteError } = await supabase.from('pdf_library').delete().in('id', ids)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({ deleted: ids.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// Compatibilidade com registros criados antes da migration 005, quando o bucket
// ainda era público e só a URL completa era guardada (não o caminho isolado).
function pathFromLegacyUrl(fileUrl: string | null): string | null {
  if (!fileUrl) return null
  const match = fileUrl.match(/\/pdfs\/(.+)$/)
  return match ? match[1] : null
}
