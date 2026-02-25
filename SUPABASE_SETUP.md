# Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor and run [supabase/schema.sql](/Users/pranavsharma/Documents/New project/supabase/schema.sql).
3. In Supabase Auth settings, enable Email sign-in.
4. Edit [config.js](/Users/pranavsharma/Documents/New project/config.js).
5. Set:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Commit + push + redeploy app on Render.

Notes:
- `SUPABASE_ANON_KEY` is safe to expose in frontend apps.
- Existing local list is kept. When you sign in, cloud data loads for that account.
