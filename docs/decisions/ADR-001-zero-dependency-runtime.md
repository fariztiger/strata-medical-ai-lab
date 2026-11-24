# ADR-001: Zero-dependency runtime for the ContentVault MVP

- Status: Accepted
- Date: 2026-11-24
- Milestone: M005 (threat model), M006 (functional prototype)

## Context

AGENTS.md section 9 proposes Supabase Auth, PostgreSQL and Supabase private
Storage. Section 24 restricts autonomous work to local development with no paid
expenditure and no deployment. Section 26 requires a *working vertical slice* in
the first session, not a mockup.

Two facts shaped the decision:

1. The owner's environment is a Windows desktop with Node.js 24 and Python 3.12
   already present. Installing a PostgreSQL server or provisioning a cloud
   project is blocked behind human approval and recurring cost.
2. A prototype that depends on a remote backend cannot be demonstrated offline
   or tested cheaply, and would make the security properties harder to verify
   locally.

## Decision

Build ContentVault v0.1 on **Node.js standard library only**:

| Concern | Prototype | Production target |
| --- | --- | --- |
| HTTP server | `node:http` | unchanged, or Vercel adapter |
| Database | `node:sqlite` (built in since Node 22.5) | PostgreSQL + RLS |
| Private object store | Local directory, non-public, outside the web root | Supabase private Storage |
| Page rendering | Python 3.12 + PyMuPDF | PyMuPDF service (same code) |
| Watermarking | Python + PyMuPDF (burned into raster) | unchanged |
| Auth | scrypt password hashes + HMAC session tokens | Supabase Auth |

**Zero npm runtime dependencies.** PyMuPDF is the only third-party component and
is vendored into `vendor/pylibs` (see ADR-002).

## Consequences

Positive:

- The prototype runs on the owner's machine with no accounts, no API keys and no
  recurring cost. The funding cap is not touched.
- No supply-chain surface from npm for the security-critical path.
- The full vertical slice is inspectable and testable in this session.
- Architecture maps 1:1 onto the Supabase target, so migration is a swap of the
  repository layer, not a rewrite.

Negative / accepted limitations:

- SQLite has no Row Level Security. Authorisation is therefore enforced in a
  single server-side module (`src/authz.js`). This is *stricter* than RLS in one
  sense - there is one place to audit - but it is not a substitute for RLS when
  clients can reach the database directly. **When migrating to Supabase, RLS
  policies must be written and independently reviewed; do not expose the
  Postgres service-role key to clients.**
- Single-writer concurrency. Fine for a proof of concept with a handful of
  students; not for a pilot cohort.
- The local object store is a real directory. On the demonstration machine it is
  protected by filesystem permissions only, not by a cloud IAM policy.

## Verification

`node scripts/check-db.js` creates the schema and reports:

```
tables: audit_log, chapters, documents, entitlements, rate_limits,
        reading_progress, sessions, users
sqlite: 3.53.4
```
