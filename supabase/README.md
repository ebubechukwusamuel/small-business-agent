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
