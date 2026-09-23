-- ComunicaPro - Vários assessores, cada um com sua carteira
--
-- O isolamento já existe e é por TIME: toda tabela de dados de cliente tem
-- team_id e uma policy que só deixa ver o time de quem está logado, e os PDFs
-- no Storage ficam em pastas nomeadas pelo team_id, com policy equivalente.
-- Então "cada assessor com sua lista" = um time por assessor. Nada de novo a
-- inventar no modelo de dados; o que falta é provisionar e administrar.
--
-- Quem pode criar assessor precisa ser explícito. Sem isso, qualquer dono de
-- time poderia criar outros times e usuários, e o app deixaria de ter uma
-- fronteira clara de administração.
create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.super_admins enable row level security;

-- Cada um só enxerga a própria linha: serve para o app saber se deve mostrar
-- a tela de administração, sem revelar quem mais é admin.
drop policy if exists "vejo_a_minha" on public.super_admins;
create policy "vejo_a_minha" on public.super_admins
  for select using (user_id = auth.uid());

-- Ninguém promove ninguém pelo app: a tabela só é escrita pela service role
-- (painel do Supabase ou migration). É a trava que impede escalonamento.
revoke insert, update, delete on public.super_admins from authenticated, anon;

-- O dono do time existente vira o primeiro administrador.
insert into public.super_admins (user_id)
select owner_id from public.teams where owner_id is not null
on conflict (user_id) do nothing;

-- ============================================
-- Visão administrativa dos times
-- ============================================
-- Um super admin precisa ver os times que administra para saber o que existe,
-- sem que isso abra a carteira de clientes de ninguém: devolve só contagens.
create or replace function public.listar_times_admin()
returns table (
  team_id uuid,
  nome text,
  membros bigint,
  contatos bigint,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.super_admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  return query
    select t.id, t.name,
           (select count(*) from public.team_members m where m.team_id = t.id),
           (select count(*) from public.contacts c where c.team_id = t.id),
           t.created_at
    from public.teams t
    order by t.created_at;
end;
$$;

revoke execute on function public.listar_times_admin() from public, anon;
grant execute on function public.listar_times_admin() to authenticated;
