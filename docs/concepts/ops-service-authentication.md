# Service Authentication and Authorization

## Purpose
Shoppers sign in once and every backend call made on their behalf must carry a verifiable identity, while catalog browsing stays open. A single identity provider and two consuming styles (browser sessions, bearer-token APIs) keep that consistent.

## Approach
Identity.API is the OpenID Connect provider and issues tokens to registered clients. Browser-facing deployables (WebApp, WebhookClient) keep a cookie session established by the OIDC authorization-code flow, and forward the signed-in user's access token to backends through the shared auth-token handler on their HTTP and gRPC clients. Protected APIs (Basket, Ordering, Webhooks) validate that token as a JWT bearer through the shared default authentication, which is active only when an `Identity` configuration section exists, and require authorization on their route groups. The user id is the token `sub` claim, which the shared authentication deliberately does not remap to the name-identifier claim. Webhook callbacks to subscribers use a separate shared-secret header instead of tokens.

## Rules

- MUST authenticate browser users with a cookie session backed by the OIDC authorization-code flow against Identity.API.
- MUST forward the user's access token to backend calls through the shared auth-token handler.
- MUST validate API tokens as JWT bearer through the shared default authentication, not per-service authentication code.
- MUST require authorization on every route group of an API that serves user-specific data.
- MUST read the user id from the `sub` claim.
- MUST send the subscription token in the dedicated webhook header on webhook callbacks, and a receiving client MUST compare it with its configured token whenever token validation is enabled.

### Variant: Public access
**Selected when:** the endpoint serves data that every visitor, signed in or not, may read (the catalog, and reading an anonymous visitor's empty basket).

- MUST be exempt from authorization explicitly (the catalog registers none; the basket read allows anonymous callers).
- Basket writes MUST still require an identified user.

### Variant: No authentication
**Selected when:** the deployable exposes no user-facing or service-facing API (the order and payment workers).

- MUST NOT register authentication.

## Security / Safety Controls
Known sample-level limitations, recorded as observations and not as rules: client secrets for the registered OIDC clients are hard-coded in source, HTTPS metadata is not required, and token audience validation is disabled in the shared authentication.

## Validation / Testing
Identity client scopes, webhook sender header, and webhook client token acceptance are unit-tested. Functional tests replace real authentication with injected test identities; real JWT and OIDC flows are not exercised.

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Identity provider | OIDC provider and client registrations | `eShop`: Identity.API startup, `Config` |
| API token validation | JWT bearer defaults | `eShop`: `AuthenticationExtensions`; configuration keys `Identity:Url`, `Identity:Audience` |
| Token propagation | Bearer token forwarded to backends | `eShop`: `HttpClientExtensions` |
| Public access | Open catalog, anonymous basket read | `eShop`: `CatalogApi`, `BasketService` |
| Authorized APIs | Route groups requiring authorization | `eShop`: `OrdersApi`, Webhooks.API route group |
| Webhook token | Subscriber callback secret | `eShop`: `WebhooksSender`, `GrantUrlTesterService`, `WebhookEndpoints`, `WebhookClientOptions`; header `X-eshop-whtoken` |
| Tests | Client scopes, webhook token | `eShop`: `IdentityConfigurationTests`, `WebhookTests`, `WebhookClientTests`, `AutoAuthorizeMiddleware`, `TestAuthenticationMiddleware` |
