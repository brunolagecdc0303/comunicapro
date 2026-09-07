-- ComunicaPro - Correções apontadas pelo Security Advisor do Supabase após o deploy

-- contact_group_members tinha RLS habilitada sem nenhuma policy (ninguém,
-- nem os próprios membros do time, conseguia usar grupos de contatos).
create policy "team_access" on public.contact_group_members
  for all using (
    group_id in (
      select id from public.contact_groups where team_id in (
        select team_id from public.team_members where user_id = auth.uid()
      )
    )
  );

-- Função trigger antiga sem search_path fixo (linter: function_search_path_mutable)
alter function public.update_campaign_counts() set search_path = public;

-- cancel_campaign nunca teve o EXECUTE revogado do role padrão (PUBLIC),
-- então tecnicamente também era chamável por anon (a checagem interna de
-- membership bloqueava na prática, mas o ideal é fechar isso na permissão).
revoke execute on function public.cancel_campaign(uuid) from public, anon;
