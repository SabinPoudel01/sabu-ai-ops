# Sabu AI Ops v1.1 — Zero-budget Cloud Assistant

**Start with [START-HERE.md](START-HERE.md)** for more details.

## One-click mobile deployment (Cloudflare)

[**Deploy this project to Cloudflare**](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FSabinPoudel01%2Fsabu-ai-ops)

From a phone browser: sign in to Cloudflare, approve the GitHub connection, keep the Worker configuration and D1 database binding, and use the suggested `npm run deploy` script so the database migrations are applied. Cloudflare's official repository deployment flow can provision the D1 binding automatically.

**Secrets needed before the first admin registration:** enter a securely generated random `BOOTSTRAP_TOKEN` (at least 32 characters) and `ENCRYPTION_KEY` (base64 of 32 random bytes) in the private Cloudflare setup. Never store these in GitHub. If the Cloudflare wizard does not request them, configure them under the deployed Worker's Secrets before registration. The initial admin wizard handles provider accounts, phone number, and monitored projects, not infrastructure secrets.

Cloudflare's deploy flow may create a separate GitHub copy for deployment. It does not modify existing Hotel PMS repositories. This project is not yet live until the deployment and first-run setup are completed. 

Cloudflare Worker API + static admin portal + Cloudflare D1 SQL + cron monitoring. After first deployment the owner uses an in-app onboarding wizard, adding multiple free-tier or eligible trial providers (Gemini AI, OpenAI held in zero-spend mode, Telegram alerts and Twilio trial) and projects.

## Install commands (Cloudflare account authentication required once)

```bash
npm install
npx wrangler login
npm run first-deploy
```

The installer creates/selects D1, applies migrations, deploys the application and securely creates the missing one-time bootstrap and encryption secrets. It does not rotate existing master secrets, delete existing data or turn on paid APIs.

Other commands: `npm run check`, `npm run first-deploy -- --check-plan`, `npm run dev` (needs local D1 migration and local test secrets). **For source-repository Deploy-to-Cloudflare builds**, `npm run deploy` applies migrations and deploys; Cloudflare provisions the configured D1 resource and prompts for required secrets.

Security: credentials stored AES-GCM encrypted in D1, admin sessions are HttpOnly cookies, webhook signatures checked, zero-spend hardcoded true. Local quota counters are not real-time balance checks. Secrets cannot be recovered from the API and must not be committed. Always use legally available trial credits only.

Known limitations: no live cloud account authorization or real telephone testing in this downloadable package; phone trial support depends on provider eligibility; autonomous repository edits/deployments not implemented in v1.1.
