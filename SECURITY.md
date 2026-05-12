# Security Policy

Ornn is an agent-facing API. A vulnerability in Ornn can affect every agent connected to it, so we take disclosure seriously and aim to acknowledge reports quickly.

## Supported Versions

Only the latest release on the [`main`](https://github.com/ChronoAIProject/Ornn/tree/main) branch receives security updates. We do not backport fixes to older versions.

| Version       | Supported          |
| ------------- | ------------------ |
| Latest `main` | :white_check_mark: |
| Anything else | :x:                |

## Reporting a Vulnerability

**Do not file a public GitHub issue for security vulnerabilities.** Public issues are indexed and visible before a fix can ship.

Use GitHub's **[Private Vulnerability Reporting](https://github.com/ChronoAIProject/Ornn/security/advisories/new)** instead. It creates a private advisory thread visible only to maintainers and you.

Please include, at minimum:

- A clear description of the vulnerability and its impact.
- Reproduction steps or a proof-of-concept.
- The commit SHA, release tag, or deployment URL where you observed it.
- Your assessment of severity (e.g. CVSS vector, or a plain-English worst case).

If you cannot use GitHub's reporting flow, open an empty issue titled "Security contact request" and a maintainer will reach out through a private channel — **do not include any vulnerability details in that issue**.

## What to Expect

- **Acknowledgement:** within 3 business days.
- **Initial assessment:** within 7 business days, including a severity rating and a rough remediation timeline.
- **Fix and disclosure:** coordinated with you. We aim to ship a fix within 30 days for high/critical findings; lower-severity findings may be batched into the next release.
- **Credit:** if you'd like, we'll credit you in the published GitHub Security Advisory and the release notes. Anonymous reports are fine too.

## Scope

In scope:

- This repository's source code (`ornn-api`, `ornn-web`, SDKs, deployment manifests).
- The hosted instance at `https://ornn.chrono-ai.fun`.

Out of scope:

- Dependencies — please report upstream first; we'll follow when a CVE is published.
- Social engineering, physical attacks, or denial-of-service against the hosted instance.
- Findings on third-party services Ornn integrates with (NyxID, MinIO, OpenSandbox, MongoDB) — report those to the respective project.

## Safe Harbour

Good-faith security research conducted within the scope above is welcome. We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service degradation.
- Give us reasonable time to remediate before any public disclosure.
- Do not exploit the vulnerability beyond what is necessary to demonstrate it.

Thank you for helping keep Ornn and the agents that depend on it safe.
