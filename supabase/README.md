# Supabase schema and migration notes

The hosted database was provisioned for this product before source control was available. The live schema has eight public tables and twenty-three row-level security policies. Each public application table has RLS enabled and table-level privileges are explicitly granted; anonymous access has not been granted to the application tables.

## Current tables

| Table | Purpose |
|---|---|
| `profiles` | App-specific user profile fields tied to `auth.users` |
| `workspaces` | Small-business/team workspaces |
| `workspace_members` | Workspace membership and owner/admin/member roles |
| `leads` | Lead/contact data, status, notes, and workspace-scoped email deduplication |
| `lead_imports` | CSV import summary, counts, and row-level errors |
| `lead_research` | Manually verified notes, research status, and source URLs |
| `follow_up_drafts` | Email drafts, status, reviewer details, and sending/reply metadata |
| `lead_activity` | Workspace activity history |

## Outreach integrations and status RPCs

The app's Apollo integration uses server-only `APOLLO_API_KEY` and `APOLLO_SEQUENCE_ID` environment variables. Never expose the Apollo API key to the browser. AI draft generation uses `AI_DRAFT_MODEL=anthropic/claude-haiku-4.5` and Vercel AI Gateway authentication; Vercel-hosted deployments can use OIDC, while local development needs a private `AI_GATEWAY_API_KEY`. Do not purchase AI Gateway credits without reviewing the price and approval first.

The app supports a single approved-message send through Apollo after a workspace owner/admin explicitly confirms the recipient and subject. It also provides separate Apollo sequence activation/enrollment routes. These routes are gated by `APOLLO_SEQUENCE_READY=true`; leave that flag unset until the existing four-step Apollo sequence has non-empty subject lines and all touches are approved in Apollo. Sequence enrollment can send a real scheduled message, so the UI requires a separate confirmation for each lead. Demo/test addresses ending in `.example`, `.test`, or `.invalid` are blocked.

The server-side status RPCs `record_apollo_email_queued`, `record_apollo_email_sent`, and `clear_apollo_email_queue` only work for an authenticated workspace owner/admin, only for an approved draft, and require a valid Apollo message ID. No email or sequence was sent/activated during setup.

## Workspace creation

A database function, `public.create_workspace(p_name text, p_slug text)`, creates a workspace with `owner_id` derived from `auth.uid()` inside the current authenticated request. It is **SECURITY INVOKER** (not SECURITY DEFINER), has an empty search path, and execution is granted only to the `authenticated` role. The existing `workspaces_insert_owner` RLS policy remains the authorization boundary, and the existing after-insert trigger adds the authenticated owner as the initial workspace member.

Use this RPC rather than sending `owner_id` from client-side React state. It avoids mismatches between a cached client state value and the identity validated by the database.

This function was applied directly to the hosted project after the initial schema setup, before the app repository was available. It must be included in the eventual reconciled initial migration baseline.

## Important safety properties

- RLS is enabled for all public application tables.
- Membership helper functions live in the non-exposed `private` schema and use a fixed search path.
- A lead, research record, or draft cannot be moved to a different workspace by changing its `workspace_id`.
- Email drafts require approval metadata before they can enter the `sent` state; normal authenticated clients are not allowed to mark drafts as sent.
- There is no live email sender or active automation in this build.
- No sample prospect or follow-up data was inserted into the hosted project.

## Migration-history caveat

The initial SQL was run directly against the hosted database using the Supabase connection and then checked using schema introspection and security/performance advisors. Because this happened before the source repo could be created, there is not yet a committed, replayable initial migration or synced migration-history baseline in this bundle.

**Do not run `supabase db push` against the existing hosted database until a schema snapshot and migration baseline have been reconciled.** A future database snapshot should be compared against the live project before it is committed as a migration. The notes here document the live schema; they are not an executable SQL migration.
