# Mobile-only deployment (v1.1)

**The old manual database UUID / migration steps are no longer needed.**

Open [START-HERE.md](START-HERE.md) for the complete one-time browser-based install.

## Simple path

1. Sign into GitHub in your phone browser. Create a **new private repository** for `sabu-ai-ops` and upload/extract this ZIP's source files into the repository using GitHub Codespaces. Don't place the ZIP file itself as a single GitHub file.
2. In the new repository's Codespaces terminal, run:

   ```bash
   npm install && npx wrangler login && npm run first-deploy
   ```

   Authorize your Cloudflare account. If login cannot redirect correctly from Codespaces, configure a narrowly scoped Cloudflare API token as a secure Codespaces secret; never paste credentials in chats or commits.
3. The installer **creates or selects the D1 database, applies all SQL migrations, deploys the backend and portal and generates the missing setup/encryption secrets**. Copy the one-time setup token displayed in your private terminal. Open your `workers.dev` URL.
4. On first visit, create your admin account. The next screen is **Initial setup**, where you may add your +977 phone, multiple eligible free accounts, and monitored projects now or later.

## Notes

- Cloudflare Pages **ZIP drag-and-drop alone cannot create D1 or this Worker backend**. Cloudflare supports automatic provisioning from a Git-linked Worker, not a plain static Pages ZIP.
- Public GitHub source can optionally use Cloudflare's Deploy-to-Cloudflare flow. Configure the requested secrets during deployment and let `npm run deploy` apply D1 migrations automatically. Private repo + Codespaces installer is recommended.
- All calls and AI are opt-in and subject to real provider credits and permissions. `ZERO_SPEND` stays enabled.
- Rerunning the installer preserves the database and encryption key. A new install uses a separate Worker/database namespace and does not touch existing Hotel PMS projects.
