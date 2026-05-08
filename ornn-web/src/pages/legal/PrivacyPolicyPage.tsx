/**
 * Privacy Policy.
 *
 * English-only at launch. Audited by Chrono AI legal before changing
 * the substance of any section — this is the document users will rely
 * on when exercising data-subject rights, and it's the disclosure that
 * keeps PostHog / NyxID / MongoDB in scope as documented sub-processors.
 *
 * @module pages/legal/PrivacyPolicyPage
 */

import { LegalLayout } from "./LegalLayout";

export function PrivacyPolicyPage() {
  return (
    <LegalLayout
      eyebrow="[ § — PRIVACY POLICY ]"
      title="Privacy Policy"
      lastUpdatedIso="2026-05-08"
    >
      <p>
        This Privacy Policy explains how <strong>Chrono AI Pte. Ltd.</strong>{" "}
        ("Chrono AI", "we", "us") collects, uses, and protects information
        when you use Ornn (the "Service") at{" "}
        <a href="https://ornn.chrono-ai.fun">ornn.chrono-ai.fun</a> and its{/* allow-hardcode canonical product origin in legal text */}
        APIs.
      </p>

      <h2>1. Information we collect</h2>

      <h3>1.1 Account information (via NyxID)</h3>
      <p>
        Sign-in is handled by our identity provider, NyxID. When you log
        in we receive your NyxID user identifier, email address, display
        name, and the OAuth scopes you grant.
      </p>

      <h3>1.2 Content you create</h3>
      <p>
        Skill packages you upload, skill descriptions, generation prompts
        you submit, playground messages, and any metadata you attach (tags,
        categories, version notes) are stored on our servers so the Service
        can host, version, and audit them on your behalf.
      </p>

      <h3>1.3 Operational telemetry</h3>
      <p>
        We log every API request the Service handles — HTTP method, route,
        response status, duration, IP-derived country (the source IP itself
        is redacted to /24 IPv4 / /48 IPv6 before storage), browser
        user-agent, and a request id used for cross-log correlation. This
        is used for security, abuse detection, and capacity planning.
      </p>

      <h3>1.4 Product analytics (PostHog)</h3>
      <p>
        With your consent (granted or denied via the cookie banner), we use
        PostHog Inc. to collect product-analytics events: page views,
        feature usage (e.g. "skill.created", "playground.run.completed"),
        and optional session replays. Session replays mask all rendered
        text, all input values, and all elements marked as sensitive — only
        layout, click positions, and navigation flow are recorded. We
        honor the browser's "Do Not Track" signal.
      </p>

      <h3>1.5 Cookies and similar technologies</h3>
      <p>
        We use a small number of first-party cookies and{" "}
        <code>localStorage</code> entries:
      </p>
      <ul>
        <li>
          <strong>Authentication state</strong> — your refresh and access
          tokens, kept locally so you don't have to sign in on every visit.
        </li>
        <li>
          <strong>Cookie consent choice</strong> — your accept/decline
          decision so we don't re-prompt every visit.
        </li>
        <li>
          <strong>UI preferences</strong> — theme, language.
        </li>
        <li>
          <strong>PostHog SDK</strong> — only when you've consented to
          analytics. Used by PostHog to assign you a stable analytics id so
          their funnels work.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide, secure, and improve the Service.</li>
        <li>To authenticate your account and authorize your actions.</li>
        <li>
          To operate the skill marketplace (host, version, audit, mirror).
        </li>
        <li>To detect abuse and enforce our Acceptable Use Policy.</li>
        <li>To send service-related notifications.</li>
        <li>
          To analyze product usage in aggregate (with your analytics
          consent) so we can prioritize features.
        </li>
      </ul>

      <h2>3. Sub-processors and third parties</h2>
      <p>
        We share specific data with the following sub-processors only to
        the extent required to operate the Service:
      </p>
      <ul>
        <li>
          <strong>NyxID (Chrono AI internal)</strong> — identity, OAuth,
          API proxy.
        </li>
        <li>
          <strong>MongoDB Atlas / our hosting provider</strong> —
          application database and infrastructure.
        </li>
        <li>
          <strong>PostHog Inc. (US)</strong> — product analytics + session
          replay (consent-gated).
        </li>
        <li>
          <strong>chrono-storage / chrono-sandbox (Chrono AI internal)</strong>{" "}
          — skill package storage and sandboxed execution.
        </li>
      </ul>
      <p>
        We do not sell personal information. We do not share your data
        with advertisers.
      </p>

      <h2>4. Data residency and retention</h2>
      <p>
        Application data is stored in our managed-database region (currently
        Asia-Pacific). PostHog analytics are stored in the PostHog region
        you see configured in the Service (US or EU). We retain account
        and content data for as long as your account is active, and for a
        reasonable period afterward to handle disputes and comply with
        legal obligations. Operational logs are kept for 30 days; product
        analytics for up to 12 months.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Subject to applicable law (including the EU GDPR, UK GDPR, US
        CCPA, and Singapore PDPA), you have the right to:
      </p>
      <ul>
        <li>Access the personal information we hold about you.</li>
        <li>Correct or update inaccurate information.</li>
        <li>Delete your account and associated data.</li>
        <li>Export your content in a portable form.</li>
        <li>Withdraw analytics consent at any time.</li>
        <li>
          Lodge a complaint with your local data-protection authority.
        </li>
      </ul>
      <p>
        Email <a href="mailto:legal@chrono-ai.fun">legal@chrono-ai.fun</a>{" "}
        to exercise any of these rights. We respond within 30 days.
      </p>

      <h2>6. Security</h2>
      <p>
        We use TLS for all traffic, encrypted storage at rest for sensitive
        configuration secrets (e.g. integration credentials), and least-
        privilege access controls inside Chrono AI. No security model is
        perfect — please report any vulnerability you find to{" "}
        <a href="mailto:security@chrono-ai.fun">security@chrono-ai.fun</a>.
      </p>

      <h2>7. International transfers</h2>
      <p>
        We process and store data in jurisdictions where Chrono AI and our
        sub-processors operate. When we transfer data across borders we
        use standard contractual safeguards (SCCs or equivalent) where
        legally required.
      </p>

      <h2>8. Children</h2>
      <p>
        Ornn is not directed at children under 16. We do not knowingly
        collect personal information from children. If you believe a child
        has provided us with information, contact us and we will delete it.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We will update the "Last updated" date at the top of this page
        whenever we revise this policy. For material changes that affect
        your rights, we will notify you in-product or by email at least 14
        days before the change takes effect.
      </p>

      <h2>10. Contact</h2>
      <p>
        Privacy questions or requests:{" "}
        <a href="mailto:legal@chrono-ai.fun">legal@chrono-ai.fun</a>.<br />
        Security disclosures:{" "}
        <a href="mailto:security@chrono-ai.fun">security@chrono-ai.fun</a>.
      </p>
    </LegalLayout>
  );
}
