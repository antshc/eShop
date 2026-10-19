# eShop Overview

eShop is a .NET 10 reference e-commerce application ("AdventureWorks") built as a services-based architecture orchestrated by Aspire. Services (Catalog, Basket, Ordering, Identity, Webhooks, payment/order processors) communicate over HTTP/gRPC and a RabbitMQ-backed integration-event bus, with Blazor (WebApp) and .NET MAUI (HybridApp, ClientApp) front ends.

## Context

See [GLOSSARY.md](GLOSSARY.md) for the shared language.
