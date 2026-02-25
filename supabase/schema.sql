create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  category text,
  quantity integer not null default 1,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, client_id)
);

create table if not exists public.item_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  item_client_id text not null,
  store text not null,
  price numeric not null,
  source text,
  updated_at timestamptz not null default now(),
  unique(user_id, client_id)
);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.shopping_items to authenticated;
grant select, insert, update, delete on public.item_prices to authenticated;

alter table public.shopping_items enable row level security;
alter table public.item_prices enable row level security;

drop policy if exists "users_manage_own_items" on public.shopping_items;
create policy "users_manage_own_items"
on public.shopping_items
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users_manage_own_prices" on public.item_prices;
create policy "users_manage_own_prices"
on public.item_prices
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
