# Configuration and Secrets

## Purpose
Each deployable runs on a developer machine, in tests, and in Azure through the same AppHost. Environment-specific values (connection strings, service URLs, credentials) must come from the environment, not from code, so the same build runs in all three.

## Approach
The AppHost is the source of runtime configuration. It declares resources and hands them to services as references, which arrive as connection-string settings, and injects service URLs and feature flags as environment variables. Service tunables live in typed options classes bound from a dedicated configuration section. Local-development files carry only localhost values. Secrets come from the Aspire secret store, or from User Secrets for a single project. Tests override configuration in memory.

## Rules

- MUST supply connection strings to services through AppHost resource references.
- MUST supply service URLs and feature switches to services through AppHost environment injection.
- MUST expose service tunables as a typed options class bound from a dedicated configuration section, not as scattered configuration reads.
- MUST keep secrets in the Aspire secret store or User Secrets.
- MUST NOT commit secrets, tokens or client secrets to source or to checked-in settings files.
- MUST override configuration in tests through in-memory configuration, not edited settings files.

## Failure Handling
Observed gaps, not rules: options are not validated at startup; the identity URL key is nested for the APIs and flat for the web clients; a webhook token and OIDC client secrets are committed in source and settings (a known violation of the secrets rule, see [Service Authentication and Authorization](./ops-service-authentication.md)).

## Validation / Testing
Functional fixtures and the AppHost configuration tests override and assert configuration.

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Runtime configuration | AppHost supplies references and environment | `eShop`: AppHost resource definitions; keys `ConnectionStrings:*`, `Identity__Url`, `IdentityUrl` |
| Options | Typed tunables per service | `eShop`: `EventBusOptions`, `CatalogOptions`, `BackgroundTaskOptions`, `PaymentOptions`, `WebhookClientOptions` |
| Secrets | Aspire secrets and User Secrets | `eShop`: README secrets section; User Secrets ids in the project files of AppHost, Basket, Catalog, Identity, Ordering, WebApp |
| Test overrides | In-memory configuration | `eShop`: Ordering, Catalog, Webhooks functional-test API fixtures |
