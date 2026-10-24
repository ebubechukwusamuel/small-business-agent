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

   Never put a Supabase `service_role` or secret API key into a `NEXT_PUBLIC_` variable or client-side code.

3. In Supabase Auth → URL Configuration, set Site URL to your stable hosted app URL and add that URL plus `http://localhost:3000/**` to Redirect URLs. The hosted URL must exactly match `NEXT_PUBLIC_SITE_URL`; this ensures email confirmation works when the email is opened on a phone rather than the local development machine. Keep email confirmation enabled if that matches your intended login flow.
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`, create an account, confirm it if required, then sign in. Create a workspace and begin with sample leads.

To run checks:

```bash
npm run typecheck
npm run build
```

## Enable the outreach integrations

The hosted Vercel deployment can use Vercel AI Gateway through built-in OIDC, so no AI Gateway key is required for that deployment. The app is configured to use `anthropic/claude-haiku-4.5` and caps output to 500 tokens. Vercel currently includes `$5/month` in AI Gateway usage for teams; do not purchase extra credits without reviewing the price first.

For Apollo:

1. In Apollo, open **Settings → Integrations → API Keys → Create new key**. Scope it to the endpoints used by this integration: email accounts list, contacts search/create, email draft create/send/status, and sequence search/activate/add contacts. Some Apollo endpoints require a master key; consult the endpoint permissions shown in Apollo when creating the key.
2. In Apollo, open **Settings → Outbound → Mailbox → Link mailbox** and connect the individual Gmail or Microsoft inbox you intend to send from. Set it as the default and confirm it is active.
3. In Vercel, open the `small-business-agent` project → Settings → Environment Variables. Add `APOLLO_API_KEY` as an encrypted server-only variable for Preview and Production. Do not prefix it with `NEXT_PUBLIC_` and do not paste the secret into chat.
4. Review the existing Apollo sequence `Mazion | AI Automation | B2B Services`. Its 3 follow-up steps currently need subject lines, and the touches were awaiting review when last checked. Keep it inactive until the subjects and all touches are approved.
5. Only after the sequence has been reviewed and approved, set `APOLLO_SEQUENCE_READY=true` as a server-side Vercel environment variable and redeploy. The app will then allow an owner/admin to activate the sequence and separately enroll individual approved leads, each behind an explicit confirmation.

The single-email action sends only a previously approved app draft and requires a per-message confirmation. The automated sequence uses Apollo's sequence templates and schedule. Demo addresses (`.example`, `.test`, `.invalid`) are blocked. This app does not enroll leads automatically or send anything merely because a draft was approved.

## AI draft setup (optional, cost-sensitive)

Do not fill these values until the provider/model has been chosen and its pricing reviewed. The endpoint returns a setup message without calling a model when either value is missing.

```dotenv
AI_GATEWAY_API_KEY=
AI_DRAFT_MODEL=
```

These variables are server-only: do not prefix them with `NEXT_PUBLIC_`. Use a supported current model identifier and follow the provider's terms. A generated draft is still a draft; a person must approve it. No sending service is implemented in this build.

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
