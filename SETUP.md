# Turning on the shared database (Supabase)

Without these steps the app keeps data on each device. With them, the owner's phone and the staff phone share one stock list, and the database itself enforces who can do what. Allow about 20 minutes. Button names in Supabase's dashboard may change slightly over time.

## 1. Create the project
1. Go to supabase.com and sign in with your GitHub account.
2. **New project.** Name: `stock-app`. Choose a database password (save it, you will not need it in the app). Region: **Southeast Asia (Singapore)**. Create, then wait about 2 minutes.

## 2. Create the tables and rules
1. Left menu **SQL Editor → New query**.
2. Open `supabase/migrations/001_init.sql` from this project, copy everything, paste it, press **Run**. It should say "Success. No rows returned".

## 3. Create the two sign-in accounts
1. **Authentication → Users → Add user → Create new user.**
2. Email `owner@store.local`, a password of at least 6 characters, tick **Auto Confirm User**, create.
3. Do the same for `staff@store.local` with a different password.
4. Write the two passwords down for the owner and the staff. The app asks for them on the login screen.

## 4. Switch off public sign-up
**Authentication → Sign In / Providers** (or Settings): turn **off** "Allow new users to sign up". Strangers must not be able to create accounts. Even if they could, the database shows them nothing, but switch it off anyway.

## 5. Give the accounts their roles
**SQL Editor → New query**, paste `supabase/seed.sql`, **Run**. The result table must show `owner@store.local → owner` and `staff@store.local → staff`.

## 6. Copy two values
**Project Settings → API** (or "Data API" / "API Keys"):
- **Project URL**, like `https://abcdxyz.supabase.co`
- the **anon public key** (also called the publishable key). It is meant to be public. **Never** copy the `service_role` / secret key into GitHub or the app.

## 7. Give them to GitHub
Your repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**:
- `SUPABASE_URL` = the Project URL
- `SUPABASE_ANON_KEY` = the anon public key

## 8. Rebuild the site
Repo → **Actions → Deploy to GitHub Pages → Run workflow.** Wait for the green tick (about 2 minutes), then open the site. The login page now asks for a **password** and the home page says "ข้อมูลร่วมกันทุกเครื่อง (ออนไลน์)". If you still see "PIN 1111" the variables were not picked up: check the names and run the workflow again.

## 9. Try it
1. Phone A: sign in as owner, upload `products_demo.xlsx`, then the daily files in date order.
2. Phone B: sign in as staff. The same products are there. Do a count on one product. Within about 10 seconds phone A shows the new number.
3. On phone B, the Upload and To-order tabs are not there. Even a hacked client cannot write sales or change settings: the database refuses.

## Good to know
- **Backups and pausing:** free Supabase projects pause after about a week without use and can be resumed from the dashboard. Open the app or the dashboard before the demo.
- **Resetting the demo:** Upload → Demo mode → clear all data. In shared mode this clears every device.
- **Going back:** delete the two repository variables and run the workflow again. The app returns to per-device storage. Nothing in Supabase is deleted.
- **Tests you can run:** `supabase/tests/rls_test.sql` in the SQL Editor prints PASS/FAIL for every role rule and rolls back afterwards. Run it only on a project you do not mind (it changes nothing permanently, but it needs the seed users).
