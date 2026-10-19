# Schema Migration and Persistence Stores

## Purpose
Each service owns its data and must come up against an empty or outdated database without a manual step, so a fresh Aspire run works. One shared startup mechanism applies migrations and seeds data for every database-owning service, and a clear rule chooses the store.

## Approach
Durable relational data lives in a per-service PostgreSQL database (all on one pgvector-enabled server declared in the AppHost), accessed through Entity Framework Core. Each such service registers a migration hosted service with an optional `IDbSeeder` for its context (`MigrationHostedService`, registered through `MigrateDbContextExtensions`); at startup it runs under the context's execution strategy, applies pending migrations, then runs the seeder, and records trace activities. Per-user ephemeral keyed documents (the basket) live in Redis and have no migrations. The AppHost makes dependents wait for the database, and the order processor waits for Ordering because Ordering owns the migrations of the shared ordering database.

## Rules

- MUST give each database-owning service its own database and its own EF context.
- MUST apply schema changes as EF migrations committed with the owning service, and MUST apply them at startup through the shared migration hosted service.
- MUST put reference and demo data in an `IDbSeeder` implementation for the context, run by the same hosted service after migration.
- MUST make a service that reads a database it does not own wait for the owner in the AppHost.
- SHOULD store durable relational data in PostgreSQL through EF Core.

### Variant: Redis document store
**Selected when:** the data is per-user, ephemeral, and keyed by user (the basket).

- MUST store it in Redis through a repository abstraction.
- MUST NOT add EF migrations for it.

## Failure Handling
Startup migration errors are logged and traced by the hosted service.

## Procedures
Migrations and seeders run in every environment as implemented; no separate production migration step exists in the inspected code (observation, not a rule).

## Validation / Testing
Functional fixtures start real PostgreSQL and Redis containers through Aspire. Tests of migration or seeding behavior themselves: not verified (none found).

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Shared mechanism | Migrate then seed at startup | `eShop`: `MigrateDbContextExtensions`, `MigrationHostedService`, `IDbSeeder` |
| Seeders | Per-service seed data | `eShop`: `CatalogContextSeed`, `OrderingContextSeed`, `UsersSeed` |
| Contexts | One PostgreSQL context per service | `eShop`: `CatalogContext`, `OrderingContext`, `ApplicationDbContext`, `WebhooksContext` |
| Redis store | Basket documents | `eShop`: `RedisBasketRepository` |
| Database resources | One server, one database per service | `eShop`: AppHost database resource names `catalogdb`, `identitydb`, `orderingdb`, `webhooksdb` |
| Startup ordering | Dependents wait for databases | `eShop`: AppHost resource definitions for Ordering and OrderProcessor |
| Tests | Real containers in fixtures | `eShop`: Ordering, Catalog, Webhooks functional-test API fixtures; `RedisFixture` |
