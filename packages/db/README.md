# Database package

The package owns database connections, queries, migrations, and SQLite storage
maintenance. Backend code supplies configuration and calls services:

- `createMainDbService(path)` from `@voice/db`: users, sessions, rooms,
  memberships, room seeding, migrations, and connection cleanup.
- `seedMainDatabase(path, roomNames, { fresh })` from `@voice/db`: the seed
  entry point used by the backend CLI; always closes its connection.
- `createDiagnosticsStore(path, options)` from `@voice/db/diagnostics`: call
  history, ingestion, samples, retention, and shutdown. Its implementation keeps
  the name `services/diagnostics/store.js` and does not expose a raw connection.

The backend's `#db` module only creates its configured main service instance.
Both services use Drizzle queries and schema definitions. The diagnostics store
uses Drizzle SQL expressions for coalescing and aggregate sample buckets; native
SQLite calls are limited to connection/storage maintenance. Tests may open
independent SQLite connections to verify persisted data and integrity.

Server startup and seeding still call the migration functions. Migration file
paths are relative to this package, so they work locally and inside Docker.

After changing a schema, run `pnpm --filter @voice/db db:generate` (or
`db:generate:diagnostics`), review the SQL, and commit the SQL and `meta` files
with the schema. Deploying then applies pending migrations automatically.
Do not regenerate or edit migrations that have already been applied.

The main initial migration exactly matches the converted production backup:
SHA-256 `dfd9b5312cc7175fde1bdb79890329fd0d3388284524ef1c823d1561fb5667a5`,
timestamp `1793425834601`. Its timestamp is intentionally preserved so restored
backups skip it. Empty databases apply it normally. The diagnostics initial
migration uses `IF NOT EXISTS` to adopt the existing diagnostics schema.

Unconverted main databases are rejected rather than silently marked migrated.
Restore a converted database to the configured `DB_PATH`. For a **disposable**
old local preview database only, reset it with:

```sh
DB_PATH="$PWD/backend/data/preview.db" INVITE_CODES='{"localtest":"home"}' pnpm db:seed --fresh
```

This deletes that preview database and creates an empty one. Never use `--fresh`
on a database whose accounts or history you want to keep.

`voice up` includes this package when building on the VPS. In prebuilt-image
mode, rebuild/publish the backend image before deploying these changes.
The local `voice/` tooling is ignored by Git; its bundle update is local only.
