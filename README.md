# GymFine

Workout citation tracker for small teams. One shared password, log workouts, issue fines. That's it.

Built with Vanilla JS + Vite, Supabase for storage, deployed on GitHub Pages.

---

## Forking this

### What you need
- Node.js 18+
- A free [Supabase](https://supabase.com) account

### 1. Set up Supabase

Create a new project, then run this in the SQL editor:

```sql
create table colleagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  workouts_per_week int not null default 3,
  citation_amount int not null default 25,
  created_at timestamptz default now(),
  deleted_at timestamptz default null
);

create table citations (
  id uuid primary key default gen_random_uuid(),
  colleague_id uuid references colleagues(id) on delete cascade,
  amount int not null,
  note text,
  created_at timestamptz default now()
);

create table workout_logs (
  id uuid primary key default gen_random_uuid(),
  colleague_id uuid references colleagues(id) on delete cascade,
  date date not null,
  created_at timestamptz default now()
);

create table settings (
  key text primary key,
  value text not null
);

alter table colleagues enable row level security;
alter table citations enable row level security;
alter table workout_logs enable row level security;
alter table settings enable row level security;

create policy "public read/write colleagues" on colleagues for all using (true) with check (true);
create policy "public read/write citations" on citations for all using (true) with check (true);
create policy "public read/write workout_logs" on workout_logs for all using (true) with check (true);
create policy "public read/write settings" on settings for all using (true) with check (true);
```

Then grab your **Project URL** and **anon key** from Settings → API.

### 2. Environment variables

Create a `.env` file in the project root (stays local, gitignored):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Run it

```bash
npm install
npm run dev
```

First time you open it, you'll be asked to set a shared password. Send it to your team.

---

## Deploying to GitHub Pages

In `vite.config.js`, set the base to your repo name:

```js
export default defineConfig({
  base: '/your-repo-name/',
})
```

Add your Supabase credentials as repository secrets (Settings → Secrets → Actions):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The included GitHub Actions workflow builds and deploys on every push to `main`. After the first workflow run completes:

1. Go to your repo → **Settings → Pages**
2. Under **Source**, set branch to `gh-pages` → `/ (root)` → Save

Your site will be live at `https://YOUR_USERNAME.github.io/your-repo-name/` within a minute.

> If `gh-pages` doesn't appear in the dropdown, the Actions workflow hasn't finished yet — check the **Actions** tab first.

> If the workflow fails with a 403 error, go to **Settings → Actions → General → Workflow permissions** and set it to **Read and write permissions**.
 
---

## A few things worth knowing

**Deletes are soft.** Removing a colleague sets a `deleted_at` timestamp — their citation history is preserved.

**Forgot the password?** Delete the row with `key = 'gymfine_password'` from the `settings` table in Supabase and you'll be prompted to create a new one.

**XLSX export.** The History page has a download button that exports all citations to a spreadsheet.
