-- Role and integrity tests. Run on a database that has 001_init.sql applied and the two users seeded.
-- Prints PASS/FAIL lines and rolls everything back at the end.
begin;
create temp table results (name text, pass boolean, detail text);
grant all on results to authenticated;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

create function pg_temp.fails(sql text, expect_text text default null) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return expect_text is null or sqlerrm ilike '%' || expect_text || '%';
end $$;

do $$
declare
  owner_id uuid := (select id from public.users where role = 'owner');
  staff_id uuid := (select id from public.users where role = 'staff');
  imp uuid := gen_random_uuid(); prod uuid := gen_random_uuid(); v1 bigint; v2 bigint; oh int; res jsonb;
  ch jsonb;
begin
  -- 1. owner import: product + opening + sale + receipt in one call; stock comes from the trigger
  perform pg_temp.as_user(owner_id);
  ch := jsonb_build_object(
    'imports', jsonb_build_array(jsonb_build_object('id', imp, 'filename', 't.csv', 'kind', 'pos', 'date_from', '2026-10-02T09:00:00', 'date_to', '2026-10-02T09:00:00', 'line_count', 2, 'receipts_new', 1, 'receipts_skipped', 0, 'products_created', 1, 'held_lines', 0, 'mismatch_count', 0, 'uploaded_by', owner_id, 'created_at', '2026-10-14T09:00:00')),
    'products', jsonb_build_array(jsonb_build_object('id', prod, 'item_code', '0001', 'name_th', 'ทดสอบ', 'unit_name', 'ลัง', 'source', 'pos_import', 'is_active', true)),
    'receipts', jsonb_build_array(jsonb_build_object('receipt_no', 'ORCM1', 'kind', 'sale', 'receipt_date', '2026-10-02T09:00:00', 'line_count', 1, 'import_id', imp)),
    'movements', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'opening', 'quantity', 22, 'source', 'pos_import', 'import_id', imp, 'occurred_at', '2026-10-02T09:00:00', 'created_by', owner_id, 'created_at', '2026-10-14T09:00:00'),
      jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'sale', 'quantity', -1, 'source', 'pos_import', 'import_id', imp, 'receipt_no', 'ORCM1', 'line_no', 1, 'occurred_at', '2026-10-02T09:00:00', 'created_by', owner_id, 'created_at', '2026-10-14T09:00:00')));
  v1 := public.apply_change(ch);
  select on_hand into oh from public.products where item_code = '0001';
  insert into results values ('owner import: opening 22, sale 1 -> on_hand 21 (trigger)', oh = 21, 'on_hand ' || oh);
  insert into results select 'last_sale_at set by the trigger', last_sale_at = '2026-10-02T09:00:00', last_sale_at::text from public.products where item_code = '0001';

  -- 2. same receipt twice is refused and the whole call is rolled back
  insert into results values ('duplicate receipt number is refused', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('receipts', jsonb_build_array(jsonb_build_object('receipt_no', 'ORCM1', 'kind', 'sale', 'receipt_date', '2026-10-02T09:00:00', 'line_count', 1, 'import_id', imp)))), 'duplicate'), '');

  -- 3. staff: allowed actions
  perform pg_temp.as_user(staff_id);
  v2 := public.apply_change(jsonb_build_object('movements', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'count_adjust', 'quantity', -3, 'source', 'manual', 'reason', 'count', 'occurred_at', '2026-10-14T10:00:00', 'created_by', staff_id, 'created_at', '2026-10-14T10:00:00'),
    jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'write_off', 'quantity', -2, 'source', 'manual', 'reason', 'damaged', 'occurred_at', '2026-10-14T10:01:00', 'created_by', staff_id, 'created_at', '2026-10-14T10:01:00')),
    'audit', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'user_id', staff_id, 'action', 'count', 'detail', 'x', 'created_at', '2026-10-14T10:00:00'))));
  perform pg_temp.as_admin();
  select on_hand into oh from public.products where item_code = '0001';
  insert into results values ('staff count and write-off change stock: 21 - 3 - 2 = 16', oh = 16, 'on_hand ' || oh);
  insert into results values ('data version goes up on every change', v2 > v1, v1 || ' -> ' || v2);

  -- 4. staff: refused actions
  perform pg_temp.as_user(staff_id);
  insert into results values ('staff cannot add a sale movement', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'sale', 'quantity', -1, 'source', 'manual', 'occurred_at', '2026-10-14T10:00:00', 'created_by', staff_id, 'created_at', '2026-10-14T10:00:00')))), 'row-level security'), '');
  insert into results values ('staff cannot add stock with a write-off', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'write_off', 'quantity', 50, 'source', 'manual', 'occurred_at', '2026-10-14T10:00:00', 'created_by', staff_id, 'created_at', '2026-10-14T10:00:00')))), 'row-level security'), '');
  insert into results values ('staff cannot count as someone else', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'count_adjust', 'quantity', 1, 'source', 'manual', 'occurred_at', '2026-10-14T10:00:00', 'created_by', owner_id, 'created_at', '2026-10-14T10:00:00')))), 'row-level security'), '');
  insert into results values ('staff cannot create or edit products', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('products', jsonb_build_array(jsonb_build_object('id', prod, 'item_code', '0001', 'name_th', 'hack', 'source', 'manual')))), 'row-level security'), '');
  insert into results values ('staff cannot upload an import', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('imports', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'filename', 'x', 'kind', 'pos', 'uploaded_by', staff_id, 'created_at', '2026-10-14T10:00:00')))), 'row-level security'), '');
  insert into results values ('staff cannot change settings', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('settings', jsonb_build_object('lead_time_days', 9, 'safety_days', 9, 'order_cover_days', 9, 'history_days', 9, 'min_history_days', 9, 'slow_mover_days', 9))), 'forbidden'), '');
  insert into results values ('staff cannot clear all data', pg_temp.fails('select public.apply_change(''{"clear_all": true}''::jsonb)', 'forbidden'), '');
  update public.products set on_hand = 999;
  select on_hand into oh from public.products where item_code = '0001';
  insert into results values ('staff cannot update on_hand directly (stays 16)', oh = 16, 'on_hand ' || oh);
  insert into results values ('staff cannot delete movements', pg_temp.fails('delete from public.movements', 'permission'), '');

  -- 5. staff view: sees stock, receipts and imports, but not held lines, mismatches or the audit log
  res := public.load_all();
  insert into results values ('staff load_all: products and receipts visible', jsonb_array_length(res -> 'products') = 1 and jsonb_array_length(res -> 'receipts') = 1, '');
  perform pg_temp.as_admin();
  insert into public.held (id, import_id, reason) values (gen_random_uuid(), imp, 'bad_quantity');
  perform pg_temp.as_user(staff_id);
  res := public.load_all();
  insert into results values ('staff cannot see held lines', jsonb_array_length(res -> 'held') = 0, '');
  insert into results values ('staff cannot read the audit log', (select count(*) from public.audit) = 0, '');

  -- 5b. a signed-in stranger (no row in public.users) sees nothing and can do nothing
  perform pg_temp.as_user('99999999-9999-9999-9999-999999999999');
  res := public.load_all();
  insert into results values ('stranger with a login but no shop role sees no products', jsonb_array_length(res -> 'products') = 0 and jsonb_array_length(res -> 'users') = 0, '');
  insert into results values ('stranger cannot write a movement', pg_temp.fails(format('select public.apply_change(%L::jsonb)', jsonb_build_object('movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product_id', prod, 'type', 'count_adjust', 'quantity', 1, 'source', 'manual', 'occurred_at', '2026-10-14T10:00:00', 'created_by', staff_id, 'created_at', '2026-10-14T10:00:00')))), 'row-level security'), '');

  -- 6. owner: settings, held, audit, clear_all
  perform pg_temp.as_user(owner_id);
  perform public.apply_change(jsonb_build_object('settings', jsonb_build_object('lead_time_days', 3, 'safety_days', 3, 'order_cover_days', 7, 'history_days', 14, 'min_history_days', 5, 'slow_mover_days', 30)));
  insert into results values ('owner changes settings', (select min_history_days from public.settings) = 5, '');
  res := public.load_all();
  insert into results values ('owner sees held lines and audit', jsonb_array_length(res -> 'held') = 1 and (select count(*) from public.audit) = 1, '');
  perform public.apply_change('{"clear_all": true}'::jsonb);
  insert into results values ('owner clear_all removes products, movements, imports, receipts', (select count(*) from public.products) + (select count(*) from public.movements) + (select count(*) from public.imports) + (select count(*) from public.receipts) = 0, '');
  perform pg_temp.as_admin();
end $$;

reset role;
select case when pass then 'PASS' else 'FAIL' end as result, name, detail from results;
select count(*) filter (where not pass) as failures from results;
rollback;
