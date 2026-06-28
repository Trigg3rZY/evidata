# V1 Readiness

Status: V1 feature-complete, validation in progress.

This checklist is the shortest path from a fresh checkout to a useful dogfood run. It is not a roadmap. If the run finds friction, capture it as a GitHub issue with a priority label.

## Fresh Local Run

1. Install dependencies.

   ```sh
   pnpm install
   ```

2. Create `apps/web/.env.local`.

   ```sh
   cp apps/web/.env.example apps/web/.env.local
   openssl rand -base64 32
   ```

   Set at least:

   ```sh
   APP_ENCRYPTION_KEY=<base64 value from openssl>
   METADATA_DATA_DIR=<absolute path to a local metadata directory>
   ```

   Leave `AGENT_PROVIDER` unset only for the Sample fixture flow. For a real or semi-real Data Source dogfood run, set `AGENT_PROVIDER=openai` plus an OpenAI-compatible key so the model can plan against that source's schema.

3. Start the app.

   ```sh
   pnpm --filter @evidata/web dev
   ```

4. Open `http://localhost:3000`.

## Real or Semi-Real Database

Use a throwaway database, a staging clone, or the local Postgres service. Do not use production credentials for dogfood screenshots or issue repros.

```sh
docker compose up -d
```

The local service listens on:

```text
host: localhost
port: 55432
database: evidata_test
username: postgres
password: postgres
ssl: disable
```

Seed a small schema before the UI trial, or point the Connection form at an existing safe database. `METADATA_DATA_DIR` stores evidata's own metadata; the Postgres Connection is the business data source. If you stay on the fixture provider, use the Sample Data Source and Sample-compatible questions instead of this real-source path.

## Golden Path

1. First-run setup: create the initial Owner at `/setup`.
2. Admin connection: create a Postgres Connection at `/admin/connections`, then run Test and Introspect.
3. Data Source authoring: open `/data-sources`, select the draft source, calibrate, review Suggested glossary/mappings, choose included tables, mark sensitive columns, set Policy, save, and publish.
4. Invite flow: create a Querier invite, redeem it in a second browser profile or incognito window, and confirm the Querier cannot author or manage members.
5. Ask flow: as the Querier, select the published Data Source, ask a real question, and inspect the persisted Answer and Evidence. Confirm credentials, raw secrets, and sensitive fields do not leak.
6. Correction loop: from a blocked or ambiguous answer, submit a correction; as Owner/Admin, accept or reject it in the Data Source authoring surface. If accepted, confirm a guarded rerun happens when the raised answer is still current.

## Verification Commands

Run the smallest command that proves the change you made:

```sh
pnpm typecheck
pnpm test
pnpm e2e
```

For gated Postgres integration tests:

```sh
docker compose up -d
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/evidata_test pnpm test
```

## Dogfood Notes

During validation, record:

- Did setup and connection creation need hidden knowledge?
- Did calibration produce useful Suggested context?
- Did the Answer cite enough Evidence to feel trustworthy?
- Did the UI hide credentials and sensitive data at every boundary?
- Did the Querier/Admin/Owner role split match expectations?
- What blocked the next useful question?

Create focused follow-up issues from observed friction. Skip speculative enhancements until a run proves they matter.
