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

Each app user connects their own Gmail account from **Settings → Connect Gmail**. The OAuth flow is server-side and requests only Gmail read-only access and send access. Once connected:

- AI drafts use the saved workspace business profile (offer, industry, ideal customer, writing voice, and call to action).
- When drafting for a lead with an email address, the app searches for recent messages to/from that address. It passes a short, lead-specific email history to the model to help it write a real follow-up or reply without inventing previous contact.
- Emails are only sent from an approved draft after a workspace owner/admin confirms the recipient and clicks **Send via Gmail**.
- Fictional demo email addresses ending in `.example`, `.test`, or `.invalid` are blocked.
- Gmail access and refresh tokens are encrypted at rest with AES-256-GCM in `email_connections`, which is guarded by workspace Row Level Security. The encryption key is server-only and must never be prefixed with `NEXT_PUBLIC_` or committed to GitHub.
- Users can disconnect Gmail, which removes the app's stored token and asks Google to revoke it.

### One-time Gmail setup for the app owner

The app's Gmail connection is implemented, but the production OAuth credentials must be supplied by the project owner before the button becomes available:

1. In Google Cloud Console, create/select a Google Cloud project and enable the **Gmail API**.
2. Configure the OAuth consent screen. For private testing, add the intended Google accounts as test users. Public use with Gmail read/send scopes may require Google OAuth verification; do not assume an unverified app is ready for all users.
3. Create an OAuth client ID of type **Web application**. Add this exact callback as an authorized redirect URI: `https://YOUR_DEPLOYED_HOST/api/gmail/callback`. It must match `GOOGLE_REDIRECT_URI` exactly.
4. In Vercel → `small-business-agent` → Settings → Environment Variables, add these encrypted/server-only values for Preview and Production: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GMAIL_TOKEN_ENCRYPTION_KEY`. Create the encryption key with `openssl rand -base64 32`. No Supabase service-role key is needed for this workspace-scoped integration.
5. Redeploy, sign in, open Settings, and connect Gmail. Google will show a consent screen. Test with your own mailbox and a test lead before allowing use by other people.

The Gmail connection currently reads recent messages related to a specific lead; it does not scan or ingest the entire mailbox. Email content is sent to the configured AI model only when the user requests AI drafting for that lead. Sending is always a separate, explicit action.

### Optional Apollo sequences

Apollo is separate from direct Gmail sending. The existing `Mazion | AI Automation | B2B Services` sequence is inactive and its templates need review. Do not set `APOLLO_SEQUENCE_READY=true` until the sequence subject lines and message templates have been approved in Apollo. The app will not activate it automatically or enroll contacts by itself.

## AI draft setup (cost-sensitive)

The hosted Vercel deployment is configured to use the `anthropic/claude-haiku-4.5` model through Vercel AI Gateway with Vercel's server-side OIDC authentication. Local development can use `AI_GATEWAY_API_KEY` in a private `.env.local`. Keep the model ID server-side and review usage limits before enabling additional paid usage. The app caps output to 500 tokens per draft. AI-generated emails remain drafts; a user must approve a draft before sending.

## Database

The current hosted Supabase project is `small-business-agent` (`gljbjslrlrrnyxlofhkn`) in `eu-west-1`.

The following eight public tables have been created and verified in that project:

- `profiles`
- `workspaces`
- `workspace_members`
- `leads`
- `lead_imports`
- `lead_research`
- `follow_up_drafts`
- `lead_activity`

All eight have RLS enabled. The initial hosted schema was applied and verified directly before the source repository was available; its migration-history baseline has **not** yet been captured in this bundle. See [`supabase/README.md`](supabase/README.md) before applying future SQL migrations. Do not replay an initial-schema script against the existing project without first reconciling migration history.

## Vercel

A preview build is ready at [Small Business Agent preview](https://small-business-agent-gjc373jvt-ebubesamuel978-5695s-projects.vercel.app). Vercel SSO/deployment protection is enabled, so access may require signing into the Vercel team. The preview was built from source copied from the `main` branch; this Vercel project is not yet connected to Git for automatic deployments on future pushes. Public Supabase connection settings are configured. AI variables remain absent until provider pricing is reviewed and approved. This is a protected preview, not a production release.

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
- Add email sending and n8n only as separate, explicitly approved stages, with an approval gate before any real send.
