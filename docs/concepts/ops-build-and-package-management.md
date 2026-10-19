# Build and Package Management

## Purpose
One solution holds services, MAUI apps, and many test projects. Package versions, compiler strictness, SDK version and test runner must be identical everywhere, or builds drift between machines and CI.

## Approach
Package versions are declared once in a central package file with transitive pinning; project files reference packages without versions. Shared compiler properties (implicit usings, warnings as errors, artifacts-folder output) sit in the shared build properties. The SDK and the test runner are pinned in the SDK configuration. Two solution definitions exist: the full solution including the MAUI apps, and a web filter excluding them, which is what CI builds and tests; MAUI projects build in their own workflow. NuGet restore uses nuget.org only.

## Rules

- MUST declare package versions in the central package file and reference packages without a version in projects.
- MUST set shared compiler policy in the shared build properties, not per project.
- MUST pin the SDK version and test runner in the SDK configuration.
- MUST build and test server projects through the web solution filter in CI.
- MUST NOT commit build output (artifacts, bin, obj).

### Variant: MAUI projects
**Selected when:** the project is a MAUI app or its test project.

- MUST build in the MAUI workflow, outside the web solution filter.
- MAY keep inline package versions (MAUI and ClientApp projects do; the ClientApp test project disables central management).

## Validation
The PR-validation workflow builds and tests the web filter; the MAUI workflow builds and tests the MAUI projects; the Azure pipeline builds the web filter on main.

## Implementation Map

| Concern | Stable anchor | Semantic locator |
|---|---|---|
| Central packages | Single version source | `eShop`: central package file with `ManagePackageVersionsCentrally`, transitive pinning |
| Compiler policy | Shared properties | `eShop`: root build properties (`TreatWarningsAsErrors`, `UseArtifactsOutput`) and tests build properties |
| SDK pin | SDK and runner | `eShop`: SDK configuration (`sdk`, `test` runner entries) |
| Solutions | Full vs web subset | `eShop`: `eShop.slnx`, `eShop.Web.slnf` |
| CI | Build and test entry points | `eShop`: Azure CI pipeline, PR-validation and MAUI PR-validation workflows |
| Dependency updates | Automated NuGet and npm updates | `eShop`: Dependabot configuration |
