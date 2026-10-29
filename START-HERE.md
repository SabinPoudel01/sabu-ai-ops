# Sabu AI Ops v1.1 — Auto database + setup portal

## What you asked for

- Cloudflare D1 **database is created, bound and tables are migrated automatically** by the supported installer or Deploy to Cloudflare repository flow.
- First page on your own site: set up **admin username/password**, then optional +977 phone, multiple provider accounts, quotas/priority, monitored projects.
- No database UUID to copy, no manual SQL, no coding required for the admin setup.
- **Zero spend remains locked ON**. Provider free eligibility and credits cannot be bypassed; ordinary Nepal SIM calls may not be free.

## Important: ZIP upload limitation

Cloudflare Pages Dashboard drag-and-drop ZIP publishes static assets. It does **not** automatically install this Worker API + provision D1 from the ZIP. Do not upload this complete ZIP directly into Pages and expect login/database to work.

### Mobile-only install, recommended (one-time)

1. Sign in to **GitHub**, create a **new private repository** (`sabu-ai-ops`) and place the **unzipped contents** of this folder in the repository (e.g. upload/extract in GitHub Codespaces browser; do not upload ZIP as a single repository file). Don't overwrite existing hotel projects.
2. Open the repo in **GitHub Codespaces** in your phone browser. From the terminal run:

   ```bash
   npm install && npx wrangler login && npm run first-deploy
   ```

   In Codespaces, `wrangler login` may require manually authorizing via Cloudflare in a browser. If authentication cannot complete, use a narrowly scoped Cloudflare API token configured as a Codespaces secret. **Never send access tokens through chat.**
3. Installer auto-creates/selects **D1**, applies SQL migrations, deploys Worker/assets/cron and generates Cloudflare secrets. Copy the one-time bootstrap token shown only in your private terminal. Open the `workers.dev` URL and use the first screen to register the admin.
4. In **Initial setup** screen, enter phone, add Gemini / Telegram / eligible Twilio trial accounts, then projects. None of these are required before install; they can be deferred.

Re-running `npm run first-deploy` **does not reset existing database or encryption secrets**.

### Alternative: Deploy to Cloudflare repository flow

A **public source GitHub repository** containing these files may be used with Cloudflare's Deploy-to-Cloudflare process. Cloudflare auto-provisions D1 and the `npm run deploy` script applies migrations. You must enter **BOOTSTRAP_TOKEN** (a random 32+ char string) and **ENCRYPTION_KEY** (random 32 bytes encoded as Base64) as Cloudflare Worker secrets as part of deployment. `.dev.vars.example` declares these names. **Do not use the example placeholder values.**

Deployment URL pattern is `https://deploy.workers.cloudflare.com/?url=YOUR_PUBLIC_GIT_REPO_URL`.
Do NOT put API keys, admin passwords or tokens in the repository. For a private source repo, use the first method instead.

## After install

- /health → basic worker health
- /api/bootstrap → database connected and setup status
- First visit → owner registration → guided initial setup page
- Accounts → add many AI/notification/calling provider credentials with encrypted storage, local quota and priority
- Projects → add health-check targets and optional GitHub repository names
- Automatic checks → every 10 minutes via Cloudflare cron
- No paid services are enabled by admin UI; provider free/trial restrictions still apply

## Honest limitations

- Calling a Nepal +977 SIM is **not guaranteed free**, even with trials.
- AI balances are **local counters and configured caps**, not live verified provider balances.
- A phone call can record requested actions and create an approval, but this v1.1 project **does not yet implement autonomous code fixes or production deployments**.
- The install script needs initial Cloudflare authorization once. This cannot safely happen from an unauthenticated ZIP.
- Running a Cloudflare auto-build from GitHub, or installer in Codespaces, is not equal to ZIP-only static drag-and-drop hosting.
