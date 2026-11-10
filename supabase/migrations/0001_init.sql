-- Collection et liste d'envies, privées : chaque ligne appartient à un utilisateur connecté.

create table public.holdings (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id_product integer     not null,                       -- idProduct Cardmarket
  qty        integer     not null check (qty > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, id_product)
);

create table public.wishes (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id_product   integer     not null,                     -- idProduct Cardmarket
  target_cents integer     check (target_cents > 0),     -- prix cible en centimes, facultatif
  created_at   timestamptz not null default now(),
  primary key (user_id, id_product)
);

alter table public.holdings enable row level security;
alter table public.wishes   enable row level security;

-- Aucun accès sans connexion.
revoke all on public.holdings, public.wishes from anon;
grant select, insert, update, delete on public.holdings, public.wishes to authenticated;

create policy "holdings: lire les siennes"      on public.holdings for select to authenticated using ((select auth.uid()) = user_id);
create policy "holdings: ajouter les siennes"   on public.holdings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "holdings: modifier les siennes"  on public.holdings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "holdings: supprimer les siennes" on public.holdings for delete to authenticated using ((select auth.uid()) = user_id);

create policy "wishes: lire les siennes"      on public.wishes for select to authenticated using ((select auth.uid()) = user_id);
create policy "wishes: ajouter les siennes"   on public.wishes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "wishes: modifier les siennes"  on public.wishes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "wishes: supprimer les siennes" on public.wishes for delete to authenticated using ((select auth.uid()) = user_id);
