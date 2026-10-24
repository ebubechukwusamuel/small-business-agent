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
   ```

   Never put a Supabase `service_role` or secret API key into a `NEXT_PUBLIC_` variable or client-side code.

3. In Supabase Auth settings, configure the local callback URL `http://localhost:3000/auth/callback` and your eventual app URL when you have one. Keep email confirmation enabled if that matches your intended login flow.
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

A new Vercel project named `small-business-agent` has been created, but it has no deployment yet. Its public Supabase connection settings are configured. Keep AI variables absent until cost approval. Do not deploy until you are ready to test the preview; builds and AI/provider usage should be checked against your plan and usage limits first.

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
