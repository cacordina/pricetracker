-- Abonnements aux notifications (un par appareil), pour les alertes de prix cible.
-- Le site enregistre l'abonnement de l'appareil ; la tâche quotidienne les lit avec la clé secrète.

create table public.push_subscriptions (
  endpoint   text        primary key,                  -- adresse du service push de l'appareil
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy "push: lire les siens"      on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "push: ajouter les siens"   on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push: modifier les siens"  on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push: supprimer les siens" on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
