# Reliable Integration Event Publishing
**Type:** Technical Approach

## Purpose
Services that change their own database state and tell other services about it (an order changing status, a catalog stock check) must not commit the state change and lose the event, or publish an event for a change that rolled back. The approach keeps the state change and the event atomic, and publishes after commit.

## Concept
This is the [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html). Here the outbox is the integration event log: a table owned by the service's own database context, written through `IntegrationEventLogService` in the same database transaction as the state change, with each `IntegrationEventLogEntry` carrying an `EventStateEnum` state (`NotPublished`, `InProgress`, `Published`, `PublishedFailed`). A per-service integration event service (`IOrderingIntegrationEventService`, `ICatalogIntegrationEventService`) is the only owner of save and relay; the relay moves entries to the RabbitMQ-backed `IEventBus` after the transaction commits. Consumers subscribe at startup through the event-bus builder, and handlers implement the integration event handler interface for the event type.

## Rules

- MUST write every integration event that accompanies a state change to the integration event log inside the same database transaction as that state change.
- MUST relay log entries to `IEventBus` only after the transaction has committed.
- MUST move each relayed entry through `InProgress` to `Published`, or to `PublishedFailed` when publishing throws.
- MUST route outbox writes and relay for a service through that service's integration event service, not directly through `IEventBus` from handlers or endpoints.
- MUST include the integration event log table in the model of every database context whose service publishes through the log.
- MUST register event-bus subscriptions at service startup for every integration event a service consumes.

### Variant: Direct publication
**Selected when:** the publisher makes no state change in a database it owns, so there is nothing to commit atomically with the event (a polling worker that reads orders, a stateless payment simulator).

- MUST publish through `IEventBus` directly.
- MUST NOT use the integration event log.

## Example
Ordering commits inside `TransactionBehavior`: domain-event handlers add events to the log via `OrderingIntegrationEventService`, the transaction commits, then the behavior relays the pending entries for that transaction.

## Benefits and Trade-offs
Benefits:

- State change and event cannot diverge on a crash between commit and publish.

Trade-offs:

- The relay selects only `NotPublished` entries; entries left `PublishedFailed` are not selected again by the relay, so recovery is not automated.
- Catalog saves the log entry and its state change in one resilient transaction and then relays within the same handler, while Ordering separates commit and relay in a pipeline behavior.
- Consumer-side deduplication of integration events: not verified. Ordering HTTP commands are deduplicated by request id through `IdentifiedCommand`; that does not cover integration events.

## Validation
Direct publication is unit-tested for the two workers. Tests of the integration event log and its relay: not verified (none found).

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Outbox write | Event saved in the caller's transaction | `eShop`: `IntegrationEventLogService`, `IntegrationEventLogEntry`, `EventStateEnum` |
| Per-service save and relay | Owning service publishes its own events | `eShop`: `OrderingIntegrationEventService`, `CatalogIntegrationEventService`, `ResilientTransaction` |
| Commit then relay | Relay follows commit | `eShop`: `TransactionBehavior` |
| Event bus | Broker abstraction | `eShop`: `IEventBus`, `RabbitMQEventBus` |
| Direct publication | Workers without owned state change | `eShop`: `GracePeriodManagerService`, `OrderStatusChangedToStockConfirmedIntegrationEventHandler` (PaymentProcessor) |
| Persistence | Log table per publishing context | `eShop`: `OrderingContext`, `CatalogContext` |
| Tests | Direct publication behavior | `eShop`: `OrderProcessorTests`, `PaymentProcessorTests` |
