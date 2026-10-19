# Inter-Service Communication and API Versioning
**Type:** Architecture Pattern

## Purpose
Backend services, the web front ends, and the MAUI apps exchange queries, commands, and state-change notifications. Without a stated split, each new interaction re-decides protocol, addressing, and versioning. This Concept fixes which mechanism carries which kind of interaction.

## Concept
Services form a services-based architecture over three mechanisms, each with a distinct job: synchronous versioned HTTP/JSON for queries and commands, gRPC for the basket, and RabbitMQ integration events for asynchronous state-change notification. Services address each other by Aspire service name through service discovery, never by hard-coded host. Web and worker deployables talk to backends directly; the MAUI apps reach Catalog, Ordering, and Identity through the YARP mobile-bff the AppHost defines.

## Rules

- MUST use versioned HTTP/JSON through a typed client for synchronous calls to Catalog, Ordering, and Webhooks, addressing the callee by its Aspire service name.
- MUST pin the API version in the client at registration (or in the request for clients that build requests by hand).
- MUST expose each HTTP API with API-version support and one route group per supported version.
- MUST use gRPC for the Basket service, with the contract defined in a proto file from which server and client code are generated.
- MUST announce cross-service state changes as integration events on the event bus, not as HTTP calls to the interested services (see [Reliable Integration Event Publishing](./str-reliable-integration-event-publishing.md)).
- MUST route MAUI client traffic through the mobile-bff.

### Variant: Webhook callback
**Selected when:** an external subscriber is notified of an order event.

- MUST deliver by an HTTP POST from Webhooks.API to the subscriber URL, secured as described in [Service Authentication and Authorization](./ops-service-authentication.md).

## Example
WebApp registers a typed Catalog client at the v2 route and a typed Ordering client at v1, both over service discovery; it calls Basket over gRPC and subscribes to order-status events on the event bus.

## Benefits and Trade-offs
Trade-offs:

- No written rule selects gRPC over HTTP for new internal synchronous calls; today only Basket uses gRPC. A new synchronous internal call defaults to HTTP/JSON until a decision says otherwise.
- The proto file exists as a second copy in ClientApp, generated separately; keeping the two in step is manual.

## Validation
Catalog tests exercise several API versions; Ordering and Webhooks tests pin v1; Webhook sender behavior is unit-tested.

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Typed clients and versions | Client pins callee version | `eShop`: WebApp, WebhookClient client registration; `CatalogService` in WebAppComponents |
| Versioned APIs | Route group per version | `eShop`: `CatalogApi`, `OrdersApi`, Webhooks.API route group |
| gRPC | Basket contract | `eShop`: `BasketService`; proto `basket.proto` |
| Events | Integration events over RabbitMQ | `eShop`: `IEventBus`, `RabbitMQEventBus` |
| Mobile gateway | YARP mobile-bff | `eShop`: AppHost mobile-bff resource |
| Webhook callback | Subscriber notification | `eShop`: `WebhooksSender`, `WebhookEndpoints` |
| Tests | Version selection | `eShop`: `CatalogApiTests`, `OrderingApiTests`, `WebhooksApiTests`, `WebhookTests` |
