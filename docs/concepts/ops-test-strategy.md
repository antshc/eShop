# Test Strategy

## Purpose
The solution mixes domain logic, Aspire-wired services, and browser flows that need different test depth. This Concept fixes which test kind and framework applies to which target so new tests land in the right project.

## Approach
All .NET test projects run on the Microsoft.Testing.Platform runner pinned in the SDK configuration. Three kinds exist: logic and configuration tests (MSTest with NSubstitute), container-backed API functional tests (xUnit), and Playwright end-to-end tests against the running AppHost. Functional tests start real dependencies through Aspire rather than faking them, and replace only authentication and external callbacks.

## Rules

- MUST write unit, domain, handler, processor, AppHost-configuration and MAUI-client tests with MSTest, and use NSubstitute for test doubles.
- MUST write API functional tests with xUnit, using a per-service fixture that combines `WebApplicationFactory` with an Aspire `DistributedApplication`.
- MUST start real PostgreSQL, Redis or RabbitMQ containers through Aspire in functional tests, and MUST override connection strings and the identity URL through in-memory configuration.
- MUST replace authentication in functional tests with a test identity middleware.
- MUST write browser flows as Playwright tests that run against the AppHost, with signed-in flows depending on the shared login setup project.
- MUST run the MAUI client tests in the MAUI workflow, not the web workflow.

## Example
`OrderingApiFixture` starts the Aspire application, injects its connection strings into the host under test, installs `AutoAuthorizeMiddleware`, and disposes the application afterward.

## Benefits and Trade-offs
Trade-offs:

- MSTest and xUnit coexist in one solution; xUnit is limited to container-backed functional tests.
- Functional tests need a container runtime. The Azure CI pipeline only builds; tests run in the PR-validation, MAUI and Playwright workflows.
- Real JWT and OIDC flows are not exercised outside Playwright.

## Validation
The PR-validation workflow runs every test in the web solution filter.

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Unit tests | MSTest logic tests | `eShop`: `OrderAggregateTest`, `IdentityConfigurationTests`, AppHost configuration tests |
| Functional fixtures | Aspire-backed host per service | `eShop`: `OrderingApiFixture`, `CatalogApiFixture`, `WebhooksApiFixture`, `RedisFixture` |
| Test authentication | Injected identity | `eShop`: `AutoAuthorizeMiddleware`, `TestAuthenticationMiddleware` |
| E2E | Playwright against AppHost | `eShop`: Playwright configuration, login setup, shared cart helpers in the e2e project |
| CI | Workflow split | `eShop`: PR-validation, MAUI PR-validation and Playwright workflows |
| Runner | Microsoft.Testing.Platform | `eShop`: SDK configuration test runner setting |
