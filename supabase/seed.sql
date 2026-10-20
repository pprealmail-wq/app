-- Run AFTER creating the two sign-in users in Supabase (Authentication > Users > Add user):
--   owner@store.local  and  staff@store.local   (use "Auto Confirm User")
insert into public.users (id, name, role)
select id, 'เจ้าของร้าน', 'owner' from auth.users where email = 'owner@store.local'
on conflict (id) do update set role = 'owner', is_active = true;

insert into public.users (id, name, role)
select id, 'พนักงาน', 'staff' from auth.users where email = 'staff@store.local'
on conflict (id) do update set role = 'staff', is_active = true;

select email, (select role from public.users u where u.id = a.id) as role from auth.users a order by email;
