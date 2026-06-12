# API Stability & Deprecation

This document is the public commitment about what Ornn's `/api/v1/*` surface guarantees, what it does not guarantee, and how breaking changes are communicated.

It is a normative companion to [`docs/CONVENTIONS.md`](CONVENTIONS.md) — when a route is added or removed, its stability tier MUST be declared here (and in the OpenAPI spec) before the PR lands.

---

## Current state

> **Status: alpha (v0.x).**
>
> We make **no compatibility guarantees** for the `0.x` release line. Any minor version (`0.7 → 0.8`) MAY contain breaking changes to routes, response shapes, error codes, headers, or SDK signatures.
>
> Pinning to an exact version (`@chronoai/ornn-sdk@0.7.3`, `ornn-sdk==0.7.3`) is the only way to insulate downstream code from churn during alpha.

CHANGELOG entries for each release call out breaking changes inline; see [`ornn-api/CHANGELOG.md`](../ornn-api/CHANGELOG.md) and [`ornn-web/CHANGELOG.md`](../ornn-web/CHANGELOG.md).

The exit criteria from alpha to **v1.0** are tracked in milestone [M5 — QA Pre-Launch Gate](https://github.com/ChronoAIProject/Ornn/milestones).

---

## Versioning policy (post-v1)

Once `v1.0.0` ships, Ornn follows [Semantic Versioning](https://semver.org/) for both the HTTP API and the SDK packages:

| Bump | Example | Allowed changes |
|---|---|---|
| **patch** | `1.2.3 → 1.2.4` | Bug fixes. No observable behaviour change. |
| **minor** | `1.2 → 1.3` | Backward-compatible additions: new endpoints, new optional request fields, new response fields, new tiered features. |
| **major** | `1.x → 2.0` | Breaking changes. Preceded by ≥ 2 minor releases marking the affected routes deprecated (see below). |

The API path version (`/api/v1/...`) is bumped only on a major release that requires it. Most major releases will keep `/v1/` and rely on per-route deprecation signalling.

---

## Stability tiers

Every route declares one of three tiers in the OpenAPI spec via the `x-stability` extension. The SDK exposes the same tier so clients can opt in or warn.

### `stable`

- Covered by the post-v1 semver commitment above.
- Breaking changes only at a major version bump, after deprecation.
- Default tier for `/api/v1/*` routes in the canonical surface.

### `beta`

- Subject to change in any minor release.
- Useful for features we want feedback on before locking the contract.
- Clients opt in by passing the header `Accept-Stability: beta`. Without that header the SDK refuses to call beta endpoints.

### `experimental`

- May change or disappear in any release, including patch.
- Not exposed via the default SDK clients; reached only by raw HTTP or by passing `Accept-Stability: experimental`.
- Used for shipping prototypes alongside a stable surface.

---

## Deprecation policy

When a stable route or response field is deprecated, Ornn follows [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html):

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Wed, 01 Jan 2027 00:00:00 GMT
Link: <https://github.com/ChronoAIProject/Ornn/blob/main/docs/DEPRECATIONS.md#skill-version-v1>; rel="deprecation"
```

### Lead time

- **Minimum:** the `Sunset` date is set at least **two minor releases** in the future from the release that introduces the `Deprecation: true` header.
- For routes called by published SDK versions, the sunset date is also at least **90 days** in the future.

### Signal channels

Every deprecation is announced through **all** of the following at the same time:

1. **`Deprecation` + `Sunset` headers** on every response from the deprecated route, from the release that flips the deprecation flag until the route is removed.
2. **CHANGELOG entry** in the release that introduces the deprecation, under a `### Deprecated` heading.
3. **Entry in [`docs/DEPRECATIONS.md`](DEPRECATIONS.md)** with route, sunset date, migration path, and the `Link: rel="deprecation"` anchor used in the header.
4. **GitHub release notes** linking to the `DEPRECATIONS.md` entry.

### Removal

- A deprecated route is removed only after its `Sunset` date has passed and a major version has shipped.
- Removal lands in a separate PR titled `chore(api): remove deprecated <route> (sunset <date>)` that closes the deprecation entry.

---

## Breaking-change checklist

Before merging a PR that breaks a `stable` route:

- [ ] PR title contains `BREAKING` or the commit footer carries `BREAKING CHANGE:`
- [ ] CHANGELOG `### Breaking` entry written, with migration guidance
- [ ] `docs/DEPRECATIONS.md` entry added (even if removal is far out)
- [ ] OpenAPI `x-stability` updated if the route is moving tiers
- [ ] If the SDK surface changes, the SDK READMEs and `examples/` snippets are updated
- [ ] Linked issue carries the `breaking-change` label

The `check-changeset` workflow enforces that every PR has a changeset; breaking-change PRs MUST use a `major` bump on the affected package.

---

## Open questions

1. **API version negotiation header.** `Accept-Stability` is currently a draft. If we adopt a different name pre-v1, both the convention and the SDKs change together — track in a separate issue before v1.
2. **`/api/v2/`.** Will exist if and only if a breaking change can't be safely signalled via per-route deprecation. The current expectation is that it never ships during 1.x.
