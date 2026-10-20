-- Store Stock Manager: shared database for Supabase (PostgreSQL).
-- Run this whole file once in the Supabase SQL Editor. Table and column names match docs/schema.md.
-- All writes from the app go through apply_change(), one transaction, with row-level security checked per user.

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner', 'staff')),
  is_active boolean not null default true
);

create table public.products (
  id uuid primary key,
  item_code text not null unique,
  name_th text not null,
  unit_name text not null default '',
  category text,
  supplier text,
  sell_price numeric(12,2),
  low_stock_manual integer check (low_stock_manual is null or low_stock_manual >= 0),
  on_hand integer not null default 0,          -- kept by the trigger on movements, never written by the app
  last_sale_at timestamp,                      -- store wall-clock time, no time zone
  last_movement_at timestamp,
  source text not null check (source in ('pos_import', 'product_list', 'manual')),
  is_active boolean not null default true
);
create index products_name_idx on public.products (name_th);

create table public.imports (
  id uuid primary key,
  filename text not null,
  kind text not null check (kind in ('pos', 'productList')),
  date_from timestamp,
  date_to timestamp,
  line_count integer not null default 0,
  receipts_new integer not null default 0,
  receipts_skipped integer not null default 0,
  products_created integer not null default 0,
  held_lines integer not null default 0,
  mismatch_count integer not null default 0,
  uploaded_by uuid not null references public.users(id),
  created_at timestamp not null
);

create table public.movements (
  id uuid primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null check (type in ('sale', 'receive', 'opening', 'count_adjust', 'write_off', 'correction')),
  quantity integer not null,                   -- signed
  source text not null check (source in ('pos_import', 'product_list', 'manual')),
  import_id uuid references public.imports(id) on delete set null,
  receipt_no text,
  line_no integer,
  pos_opening integer,
  unit_price numeric(12,2),
  reason text,
  occurred_at timestamp not null,
  created_by uuid not null references public.users(id),
  created_at timestamp not null
);
create index movements_product_idx on public.movements (product_id, occurred_at desc);

-- The double-counting guard: a receipt number can be applied only once.
create table public.receipts (
  receipt_no text primary key,
  kind text not null check (kind in ('sale', 'receive')),
  receipt_date timestamp not null,
  line_count integer not null,
  import_id uuid not null references public.imports(id) on delete cascade
);

create table public.held (
  id uuid primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  receipt_no text not null default '',
  item_code text not null default '',
  name_th text not null default '',
  qty text not null default '',
  reason text not null check (reason in ('unknown_prefix','sign_mismatch','missing_code','missing_receipt','missing_date','bad_quantity')),
  resolved boolean not null default false
);

create table public.mismatches (
  id uuid primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  item_code text not null,
  name_th text not null,
  app_before integer not null,
  pos_opening integer not null,
  resolved boolean not null default false
);

create table public.audit (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  action text not null,
  detail text not null default '',
  created_at timestamp not null
);

create table public.settings (
  id integer primary key check (id = 1),
  lead_time_days integer not null default 2 check (lead_time_days between 0 and 365),
  safety_days integer not null default 3 check (safety_days between 0 and 365),
  order_cover_days integer not null default 7 check (order_cover_days between 1 and 365),
  history_days integer not null default 14 check (history_days between 1 and 365),
  min_history_days integer not null default 7 check (min_history_days between 1 and 365),
  slow_mover_days integer not null default 30 check (slow_mover_days between 1 and 365)
);
insert into public.settings (id) values (1);

-- Bumped on every change so other phones know to reload.
create table public.data_version (id integer primary key check (id = 1), v bigint not null default 0);
insert into public.data_version (id) values (1);

-- ---------- helpers ----------
create function public.app_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid() and is_active
$$;

-- Statement-level triggers bump the counter; nobody can call it directly.
create function public.touch_version() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.data_version set v = v + 1 where id = 1;
  return null;
end $$;

create function public.get_version() returns bigint language sql stable security definer set search_path = public as $$
  select v from public.data_version where id = 1
$$;

-- Stock is only ever the sum of movements. The trigger is the one place that changes products.on_hand.
create function public.apply_movement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.products p set
    on_hand = p.on_hand + new.quantity,
    last_sale_at = case when new.type = 'sale' then greatest(coalesce(p.last_sale_at, new.occurred_at), new.occurred_at) else p.last_sale_at end,
    last_movement_at = case when new.type <> 'opening' then greatest(coalesce(p.last_movement_at, new.occurred_at), new.occurred_at) else p.last_movement_at end
  where p.id = new.product_id;
  return new;
end $$;
create trigger movements_apply after insert on public.movements for each row execute function public.apply_movement();

create trigger products_touch after insert or update or delete on public.products for each statement execute function public.touch_version();
create trigger movements_touch after insert on public.movements for each statement execute function public.touch_version();
create trigger imports_touch after insert or delete on public.imports for each statement execute function public.touch_version();
create trigger held_touch after insert or update or delete on public.held for each statement execute function public.touch_version();
create trigger mismatches_touch after insert or update or delete on public.mismatches for each statement execute function public.touch_version();
create trigger settings_touch after update on public.settings for each statement execute function public.touch_version();

-- ---------- row-level security ----------
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.imports enable row level security;
alter table public.movements enable row level security;
alter table public.receipts enable row level security;
alter table public.held enable row level security;
alter table public.mismatches enable row level security;
alter table public.audit enable row level security;
alter table public.settings enable row level security;
alter table public.data_version enable row level security;

create policy users_read on public.users for select to authenticated using (public.app_role() is not null);

create policy products_read on public.products for select to authenticated using (public.app_role() is not null);
create policy products_insert on public.products for insert to authenticated with check (public.app_role() = 'owner');
create policy products_update on public.products for update to authenticated using (public.app_role() = 'owner') with check (public.app_role() = 'owner');
create policy products_delete on public.products for delete to authenticated using (public.app_role() = 'owner');

create policy movements_read on public.movements for select to authenticated using (public.app_role() is not null);
create policy movements_owner_insert on public.movements for insert to authenticated with check (public.app_role() = 'owner' and created_by = auth.uid());
-- Staff may only count and write off, as themselves. They cannot add sales, deliveries or openings.
create policy movements_staff_insert on public.movements for insert to authenticated with check (
  public.app_role() = 'staff' and created_by = auth.uid() and source = 'manual'
  and (type = 'count_adjust' or (type = 'write_off' and quantity < 0))
);

create policy receipts_read on public.receipts for select to authenticated using (public.app_role() is not null);
create policy receipts_owner on public.receipts for insert to authenticated with check (public.app_role() = 'owner');

create policy imports_read on public.imports for select to authenticated using (public.app_role() is not null);
create policy imports_owner on public.imports for insert to authenticated with check (public.app_role() = 'owner' and uploaded_by = auth.uid());
create policy imports_delete on public.imports for delete to authenticated using (public.app_role() = 'owner');

create policy held_owner on public.held for all to authenticated using (public.app_role() = 'owner') with check (public.app_role() = 'owner');
create policy mismatches_owner on public.mismatches for all to authenticated using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

create policy audit_insert on public.audit for insert to authenticated with check (user_id = auth.uid());
create policy audit_read on public.audit for select to authenticated using (public.app_role() = 'owner');

create policy settings_read on public.settings for select to authenticated using (public.app_role() is not null);
create policy settings_update on public.settings for update to authenticated using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

create policy data_version_read on public.data_version for select to authenticated using (public.app_role() is not null);

-- ---------- one entry point for every write ----------
-- change is a JSON object with optional arrays: imports, products, receipts, movements, held, mismatches, audit,
-- an optional settings object, and clear_all. Security invoker: row-level security applies to the signed-in user.
create function public.apply_change(change jsonb) returns bigint language plpgsql security invoker set search_path = public as $$
begin
  if coalesce((change ->> 'clear_all')::boolean, false) then
    if public.app_role() is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
    delete from public.products;
    delete from public.imports;
  end if;

  if jsonb_typeof(change -> 'imports') = 'array' then
    insert into public.imports (id, filename, kind, date_from, date_to, line_count, receipts_new, receipts_skipped, products_created, held_lines, mismatch_count, uploaded_by, created_at)
    select x.id, x.filename, x.kind, x.date_from, x.date_to, x.line_count, x.receipts_new, x.receipts_skipped, x.products_created, x.held_lines, x.mismatch_count, x.uploaded_by, x.created_at
    from jsonb_to_recordset(change -> 'imports') as x(id uuid, filename text, kind text, date_from timestamp, date_to timestamp, line_count int, receipts_new int, receipts_skipped int, products_created int, held_lines int, mismatch_count int, uploaded_by uuid, created_at timestamp);
  end if;

  if jsonb_typeof(change -> 'products') = 'array' then
    insert into public.products (id, item_code, name_th, unit_name, category, supplier, sell_price, low_stock_manual, source, is_active)
    select x.id, x.item_code, x.name_th, coalesce(x.unit_name, ''), x.category, x.supplier, x.sell_price, x.low_stock_manual, x.source, coalesce(x.is_active, true)
    from jsonb_to_recordset(change -> 'products') as x(id uuid, item_code text, name_th text, unit_name text, category text, supplier text, sell_price numeric, low_stock_manual int, source text, is_active boolean)
    on conflict (id) do update set
      item_code = excluded.item_code, name_th = excluded.name_th, unit_name = excluded.unit_name, category = excluded.category,
      supplier = excluded.supplier, sell_price = excluded.sell_price, low_stock_manual = excluded.low_stock_manual, is_active = excluded.is_active;
  end if;

  if jsonb_typeof(change -> 'receipts') = 'array' then
    insert into public.receipts (receipt_no, kind, receipt_date, line_count, import_id)
    select x.receipt_no, x.kind, x.receipt_date, x.line_count, x.import_id
    from jsonb_to_recordset(change -> 'receipts') as x(receipt_no text, kind text, receipt_date timestamp, line_count int, import_id uuid);
  end if;

  if jsonb_typeof(change -> 'movements') = 'array' then
    insert into public.movements (id, product_id, type, quantity, source, import_id, receipt_no, line_no, pos_opening, unit_price, reason, occurred_at, created_by, created_at)
    select x.id, x.product_id, x.type, x.quantity, x.source, x.import_id, x.receipt_no, x.line_no, x.pos_opening, x.unit_price, x.reason, x.occurred_at, x.created_by, x.created_at
    from jsonb_to_recordset(change -> 'movements') as x(id uuid, product_id uuid, type text, quantity int, source text, import_id uuid, receipt_no text, line_no int, pos_opening int, unit_price numeric, reason text, occurred_at timestamp, created_by uuid, created_at timestamp);
  end if;

  if jsonb_typeof(change -> 'held') = 'array' then
    insert into public.held (id, import_id, receipt_no, item_code, name_th, qty, reason, resolved)
    select x.id, x.import_id, coalesce(x.receipt_no, ''), coalesce(x.item_code, ''), coalesce(x.name_th, ''), coalesce(x.qty, ''), x.reason, coalesce(x.resolved, false)
    from jsonb_to_recordset(change -> 'held') as x(id uuid, import_id uuid, receipt_no text, item_code text, name_th text, qty text, reason text, resolved boolean)
    on conflict (id) do update set resolved = excluded.resolved;
  end if;

  if jsonb_typeof(change -> 'mismatches') = 'array' then
    insert into public.mismatches (id, import_id, product_id, item_code, name_th, app_before, pos_opening, resolved)
    select x.id, x.import_id, x.product_id, x.item_code, x.name_th, x.app_before, x.pos_opening, coalesce(x.resolved, false)
    from jsonb_to_recordset(change -> 'mismatches') as x(id uuid, import_id uuid, product_id uuid, item_code text, name_th text, app_before int, pos_opening int, resolved boolean)
    on conflict (id) do update set resolved = excluded.resolved;
  end if;

  if jsonb_typeof(change -> 'audit') = 'array' then
    insert into public.audit (id, user_id, action, detail, created_at)
    select x.id, x.user_id, x.action, coalesce(x.detail, ''), x.created_at
    from jsonb_to_recordset(change -> 'audit') as x(id uuid, user_id uuid, action text, detail text, created_at timestamp);
  end if;

  if jsonb_typeof(change -> 'settings') = 'object' then
    if public.app_role() is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
    update public.settings s set
      lead_time_days = x.lead_time_days, safety_days = x.safety_days, order_cover_days = x.order_cover_days,
      history_days = x.history_days, min_history_days = x.min_history_days, slow_mover_days = x.slow_mover_days
    from jsonb_to_record(change -> 'settings') as x(lead_time_days int, safety_days int, order_cover_days int, history_days int, min_history_days int, slow_mover_days int)
    where s.id = 1;
  end if;

  return public.get_version();
end $$;

-- Everything the app needs on start, in one request. Row-level security decides what each role sees.
create function public.load_all() returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'users', coalesce((select jsonb_agg(to_jsonb(u)) from public.users u), '[]'),
    'products', coalesce((select jsonb_agg(to_jsonb(p)) from public.products p), '[]'),
    'movements', coalesce((select jsonb_agg(to_jsonb(m)) from public.movements m), '[]'),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r)) from public.receipts r), '[]'),
    'imports', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.imports i), '[]'),
    'held', coalesce((select jsonb_agg(to_jsonb(h)) from public.held h), '[]'),
    'mismatches', coalesce((select jsonb_agg(to_jsonb(x)) from public.mismatches x), '[]'),
    'settings', (select to_jsonb(s) from public.settings s where s.id = 1),
    'version', public.get_version()
  )
$$;

-- ---------- who may call what ----------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select on public.users, public.products, public.movements, public.receipts, public.imports, public.held, public.mismatches, public.audit, public.settings, public.data_version to authenticated;
grant insert, update, delete on public.products to authenticated;
grant insert on public.movements, public.receipts, public.audit to authenticated;
grant insert, delete on public.imports to authenticated;
grant insert, update, delete on public.held, public.mismatches to authenticated;
grant update on public.settings to authenticated;
grant execute on function public.apply_change(jsonb), public.load_all(), public.get_version(), public.app_role() to authenticated;
