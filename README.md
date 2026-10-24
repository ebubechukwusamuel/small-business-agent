# Small Business Agent

A small-team workspace for moving business leads from intake to researched follow-up drafts. The first build focuses on safe lead operations and human approval. It does **not** send email, activate outreach automations, or run web research automatically.

## Current features

- Email/password sign-up and sign-in through Supabase Auth.
- Workspace creation and owner/admin/member roles.
- Manually add leads, search/filter the lead list, and import CSV files (maximum 300 lead rows at a time).
- Workspace-scoped duplicate prevention for normalized email addresses.
- Add manually verified prospect notes and source URLs.
- Create template follow-up drafts or optionally request an AI draft.
- Owner/admin review to approve or reject drafts.
- Activity history and status tracking.
- Row Level Security (RLS) and explicit database grants for the application tables.

## What is intentionally disabled

- **Email sending:** there is no provider connected and no send button or active sending workflow.
- **AI generation:** it stays unavailable until `AI_GATEWAY_API_KEY` and `AI_DRAFT_MODEL` are both set on the server. AI/provider usage may incur charges. Review model pricing and get approval before adding a key or enabling model calls.
- **Automations and integrations:** n8n, Apollo, Clay, Gmail, and other outreach integrations are not connected or activated.
- **Live prospect research:** users can record notes and links they have checked; the app does not scrape or search the web itself.

## Tech stack

- Next.js 16 App Router, React 19, TypeScript
- Supabase Auth, Postgres, and Row Level Security
- AI SDK structured output for the optional server-side draft endpoint
- Lucide icons

## Run locally

Requirements: Node.js 22 or newer and npm.

1. Copy `.env.example` to `.env.local`.
2. In the new Supabase project, open **Project Settings → API Keys** and copy the Project URL and a **publishable** key into `.env.local`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=https://your-deployed-app-url
   ```

   Never put a Supabase `service_role` or secret API key into a `NEXT_PUBLIC_` variable or client-side code. This workspace-scoped Gmail integration does not require a service-role key.

3. In Supabase Auth → URL Configuration, set Site URL to your stable hosted app URL and add that URL plus `http://localhost:3000/**` to Redirect URLs. The hosted URL must exactly match `NEXT_PUBLIC_SITE_URL`; this ensures email confirmation works when the email is opened on a phone rather than the local development machine. Keep email confirmation enabled if that matches your intended login flow.
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`, select **Create an account**, answer the business onboarding questions, then create the login. After email confirmation, the app creates a workspace from the saved onboarding profile. Existing accounts with no workspace can create one in the app.

To run checks:

```bash
npm run typecheck
npm run build
```

## Connect Gmail, use email history, and send approved drafts

Each workspace can connect its own Gmail mailbox from **Settings → Connect Gmail**. The OAuth flow is server-side and the stored access/refresh tokens are encrypted with AES-256-GCM using a server-only encryption key.

- Each business has its own profile: offer, industry, ideal customer, value proposition, writing voice, preferred call to action, and email-history consent.
- AI uses that workspace profile, lead information, manually verified research, and only the email history that has been explicitly permitted and synced for a matching lead.
- Without prior email history, AI is instructed to write a first-contact draft and not claim a previous message was sent.
- Email history is **off by default**. Turn on **Allow AI to read relevant email history** in the Business Context form, save it, then reconnect Gmail to grant the extra read permission. Use **Sync matching email history** to import only messages matching addresses in that workspace's lead list.
- Emails are sent only from an approved draft after a workspace owner/admin explicitly confirms the recipient and presses **Send via Gmail**. Fictional demo addresses ending in `.example`, `.test`, or `.invalid` are blocked.
- A user can disconnect Gmail in Settings. The app tries to revoke the Google token and deletes the workspace connection. Previously synced email history remains in that workspace until deleted according to the project's retention policy; disconnecting doesn't automatically erase it.
- The Gmail token encryption key is only used by the server and is never returned to the browser. Workspace access is enforced by Supabase Row Level Security.

### One-time Gmail setup for the app owner

The Gmail connection is implemented, but Google OAuth credentials are not yet configured for this deployment. Until the app owner completes the steps below, **Connect Gmail** will stay disabled.

1. In Google Cloud Console, create/select a Google Cloud project and enable the **Gmail API**.
2. Configure the OAuth consent screen and publish the app details/privacy policy. For initial testing, add your own Google account as a test user.
3. Create an OAuth client of type **Web application**. Add this exact Authorized redirect URI (and use the same URL for `GOOGLE_REDIRECT_URI` if setting it explicitly):

   `https://small-business-agent-ebubesamuel978-5695s-projects.vercel.app/api/gmail/callback`

4. In Vercel → `small-business-agent` → Settings → Environment Variables, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_TOKEN_ENCRYPTION_KEY` as encrypted/server-only variables for Preview and Production. Generate the encryption key with `openssl rand -base64 32`. Never paste the Google client secret or encryption key into chat or commit them to GitHub.
5. Redeploy, sign in, open Settings, and connect a test Gmail account. Verify sending and history behavior with a real inbox you control and a non-deliverable/demo lead before contacting anyone else.

Google treats `gmail.send` as a sensitive scope and `gmail.readonly` as a restricted scope. Testing with a limited set of test users may be possible during development, but a public multi-user app may need Google OAuth verification, and restricted Gmail data stored or transmitted by a server can require a third-party security assessment. Check Google's current verification requirements before opening this to the public.

### Optional Apollo sequences

Apollo is separate from direct Gmail sending. The existing `Mazion | AI Automation | B2B Services` sequence is inactive and its templates need review. Keep `APOLLO_SEQUENCE_READY=false` until subject lines and message templates have been reviewed and approved in Apollo. This app must not activate it or enroll contacts without a separate explicit decision.

## AI draft setup (cost-sensitive)

The hosted Vercel deployment is configured to use the `anthropic/claude-haiku-4.5` model through Vercel AI Gateway with Vercel's server-side OIDC authentication. Local development can use `AI_GATEWAY_API_KEY` in a private `.env.local`. Keep the model ID server-side and review usage limits before enabling additional paid usage. The app caps output to 500 tokens per draft. AI-generated emails remain drafts; a user must approve a draft before sending.

## Database

The current hosted Supabase project is `small-business-agent` (`gljbjslrlrrnyxlofhkn`) in `eu-west-1`.

The current public tables are `profiles`, `workspaces`, `workspace_members`, `leads`, `lead_imports`, `lead_research`, `follow_up_drafts`, `lead_activity`, `business_profiles`, `email_connections`, and `email_history`. Row-level security is enabled on these tables; Gmail access tokens are encrypted and workspace-scoped. The old, unused `gmail_connections` table was removed.

The initial hosted schema and follow-on changes were applied and verified directly before the repository had a complete migration baseline. A replayable migration history has **not** yet been reconstructed from the live schema. See [`supabase/README.md`](supabase/README.md) before applying future SQL migrations. Do not replay an initial-schema script against the existing project until the live schema and migration history have been reconciled.

## Vercel

The latest build is ready at [Small Business Agent](https://small-business-agent-ebubesamuel978-5695s-projects.vercel.app). This is a preview build, not a production release. Public Supabase connection settings, the AI model ID, and the Gmail OAuth callback URL are configured. The hosted app is set up for Vercel AI Gateway's OIDC authentication, but a live AI draft has not yet been verified end to end. Gmail is not yet connectable until the app owner adds a Google OAuth client ID and secret to Vercel environment variables. The source lives on GitHub, and automatic Git deployments should be verified in Vercel project settings before relying on them.

## Safe initial test plan

1. Create a test account and workspace.
2. Add one fake/sandbox lead with a unique email.
3. Try adding the same email again; it should be rejected as a duplicate within that workspace.
4. Import a CSV containing one valid row and one duplicate row.
5. Save manual research notes and source URLs.
6. Create a template draft and confirm it appears in the approval queue.
7. Approve or reject a draft as the workspace owner. Approval does not send anything.
8. Confirm no emails, live outreach, or automation workflows are triggered.

## Known next steps

- Capture an accurate schema baseline/migration file for reproducible database setup.
- Connect the source to the new Vercel project and deploy a preview after checking expected usage/cost.
- Add tests for RLS role isolation, CSV edge cases, duplicate handling, and draft approval transitions.
- Add the Google OAuth client credentials and test Gmail connect/history-sync/send using a permitted test recipient before enabling real outreach.
- Review the optional Apollo sequence templates before deliberately activating scheduled outreach; it remains inactive.
