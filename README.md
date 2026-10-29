# Sabu AI Ops v1.1 — Zero-budget Cloud Assistant

**Start with [START-HERE.md](START-HERE.md)** for mobile deployment.

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
