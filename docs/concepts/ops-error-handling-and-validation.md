# Error Handling and Request Validation

## Purpose
A request can fail because the caller sent bad input, a business rule forbids the change, or a dependency is briefly unavailable. Callers and operators need those three kinds of failure to surface differently and consistently. The code uses several styles per service today; this Concept records the shared split and the style each situation selects.

## Approach
Failures are classified by cause. Bad input is rejected at the API boundary with a 4xx carrying `ProblemDetails` (or a validation problem for model validation). Business-rule violations are thrown from the domain as `OrderingDomainException`. Transient infrastructure faults are absorbed by resilience: the standard HTTP resilience handler on outgoing HTTP clients, the EF execution strategy around transactions, and a retry pipeline for broker connection failures in `RabbitMQEventBus`. No circuit breaker is configured.

## Rules

- MUST reject invalid input at the API boundary with a 4xx response, using `ProblemDetails` or a validation problem.
- MUST enforce domain invariants inside the aggregate and signal violations with `OrderingDomainException`, not return codes.
- MUST run outgoing HTTP calls through clients that carry the shared resilience handler.
- MUST run Ordering transactions under the context's EF execution strategy.
- MUST NOT swallow exceptions in a transaction; log them and rethrow.

### Variant: Command pipeline validation
**Selected when:** the API dispatches commands through MediatR (Ordering).

- MUST validate with FluentValidation validators run by `ValidatorBehavior`, ordered after `LoggingBehavior` and before `TransactionBehavior`.
- MUST surface validator failures as `OrderingDomainException`.
- MUST make retried HTTP commands idempotent through `IdentifiedCommand` keyed by request id.

### Variant: Model validation
**Selected when:** the API is a minimal or gRPC API without a command pipeline (Basket, Webhooks, Catalog).

- MUST validate with `IValidatableObject` or inline endpoint checks; Webhooks routes them through an endpoint filter returning a validation problem.

## Failure Handling
Observed gaps, not rules: the API hosts do not configure a global exception handler (only the two web front ends do); how `OrderingDomainException` maps to an HTTP status is not defined; `OrdersApi` converts any exception in the order read to 404; `GracePeriodManagerService` has no loop-level catch.

## Validation / Testing
Catalog invalid-id 400, Ordering command failures, Webhooks validation responses, and domain exceptions are covered by tests.

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Boundary validation | 4xx with problem details | `eShop`: `CatalogApi`, `OrdersApi`, `RouteHandlerBuilderExtensions` |
| Model validation | Self-validating request models | `eShop`: `BasketItem`, `WebhookSubscriptionRequest` |
| Command pipeline | Ordered MediatR behaviors | `eShop`: `LoggingBehavior`, `ValidatorBehavior`, `TransactionBehavior` |
| Domain failure | Invariant violation | `eShop`: `OrderingDomainException` |
| Idempotency | Request-id deduplication | `eShop`: `IdentifiedCommand`, `IdentifiedCommandHandler`, `RequestManager` |
| Resilience | Retry for transient faults | `eShop`: ServiceDefaults `Extensions` class, `RabbitMQEventBus`, `EventBusOptions` |
| Tests | Failure surface | `eShop`: `CatalogApiTests`, `OrdersWebApiTest`, `WebhooksApiTests`, `OrderAggregateTest` |
