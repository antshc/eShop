# Service Defaults and Observability

## Purpose
Every deployable needs the same telemetry, health, discovery, and outgoing-call resilience behavior to be operable under the Aspire AppHost. A single shared service-defaults library supplies it so no service configures these concerns on its own.

## Approach
Each ASP.NET-hosted deployable registers the shared service defaults from the ServiceDefaults project (static `Extensions` class). The full registration adds OpenTelemetry (logs, ASP.NET, HTTP, gRPC and runtime metrics and traces), a self liveness health check, service discovery, and the standard HTTP resilience handler on all outgoing HTTP clients. A basic registration adds only telemetry and the health check, for services that make no outgoing HTTP calls and so need neither discovery nor resilience. Authentication and OpenAPI are not part of the defaults; each is a separate opt-in driven by its own configuration section. Telemetry leaves the process through OTLP only when the standard exporter endpoint is configured.

## Rules

- MUST register the shared service defaults in every ASP.NET-hosted deployable, and map the shared health endpoints.
- MUST add service-specific trace sources on top of the shared defaults, not instead of them.
- MUST enable OTLP export only when the OTLP endpoint setting is non-blank.

### Variant: Basic service defaults
**Selected when:** the deployable makes no outgoing HTTP calls (a broker-and-database worker, a gRPC server).

- MUST register the basic variant instead of the full one.
- MUST NOT rely on service discovery or the resilience handler from the basic variant.

## Monitoring and Alerting
The self liveness check is the only shared health check. The health endpoints are mapped only in the Development environment, and the AppHost polls a health endpoint for Identity and Ordering only; this is observed behavior, not a rule.

## Validation / Testing
Tests of the defaults, endpoint mapping or AppHost health checks: not verified (none found).

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Shared registration | One library supplies telemetry, health, discovery, resilience | `eShop`: ServiceDefaults project `Extensions` class |
| Export condition | OTLP export gated by configuration | `eShop`: configuration key `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Separate opt-ins | Authentication and OpenAPI are not defaults | `eShop`: `AuthenticationExtensions`, `OpenApiOptionsExtensions` |
| Basic variant users | Services without outgoing HTTP | `eShop`: Basket.API and OrderProcessor startup |
| Custom trace source | Broker tracing on top of defaults | `eShop`: `RabbitMQEventBus`, `MigrationHostedService` |
| Health polling | AppHost health checks | `eShop`: AppHost resource definitions for Identity and Ordering |
