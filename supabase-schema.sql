-- Uruchom ten skrypt w Supabase: Dashboard -> SQL Editor -> New query -> wklej całość -> Run.
-- Tworzy tabele potrzebne do logowania i płatnego dostępu do protokołów.

-- 1 wiersz na użytkownika (dane pomocnicze; Supabase Auth i tak trzyma konto w auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Użytkownik widzi własny profil"
  on profiles for select
  using (auth.uid() = id);

create policy "Użytkownik może utworzyć własny profil"
  on profiles for insert
  with check (auth.uid() = id);

-- Automatyczne utworzenie wiersza w profiles przy rejestracji nowego konta
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Co dany użytkownik wykupił: subskrypcja (dostęp do wszystkiego) albo pojedynczy protokół
create table if not exists entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('subscription', 'protocol')),
  protocol_id text,                 -- np. 'certyfikat-3'; NULL gdy kind='subscription'
  status text not null check (status in ('active','canceled','expired')),
  stripe_customer_id text,
  stripe_subscription_id text,      -- NULL dla zakupu jednorazowego
  current_period_end timestamptz,   -- NULL dla zakupu jednorazowego (bezterminowy)
  created_at timestamptz default now()
);

alter table entitlements enable row level security;

create policy "Użytkownik widzi własne uprawnienia"
  on entitlements for select
  using (auth.uid() = user_id);

-- Celowo brak polityki insert/update dla zwykłych użytkowników.
-- Zapis do tej tabeli robi wyłącznie funkcja serwerowa (webhook Stripe)
-- używająca klucza service_role, który omija RLS.

create index if not exists entitlements_user_id_idx on entitlements(user_id);
create index if not exists entitlements_protocol_idx on entitlements(user_id, protocol_id);

-- Bez tego GRANT rola "authenticated" dostaje 403 (permission denied) z PostgREST
-- na każdym zapytaniu do tej tabeli, niezależnie od polityk RLS powyżej.
grant select on entitlements to authenticated;
grant select, insert on profiles to authenticated;

-- "service_role" pomija RLS, ale wciąż potrzebuje bazowych uprawnień GRANT na tabelę
-- (bypassrls omija tylko polityki, nie podstawowe uprawnienia SQL).
grant select, insert, update on entitlements to service_role;
grant select, insert, update on profiles to service_role;
