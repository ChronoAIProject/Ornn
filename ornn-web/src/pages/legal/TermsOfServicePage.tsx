/**
 * Terms of Service.
 *
 * @module pages/legal/TermsOfServicePage
 */

import { LegalLayout } from "./LegalLayout";

export function TermsOfServicePage() {
  return (
    <LegalLayout
      eyebrow="[ § — TERMS OF SERVICE ]"
      title="Terms of Service"
      lastUpdatedIso="2026-05-08"
    >
      <p>
        These Terms of Service ("Terms") govern your access to and use of
        Ornn (the "Service") provided by{" "}
        <strong>Chrono AI Pte. Ltd.</strong> ("Chrono AI", "we", "us"). By
        creating an account or otherwise using the Service you agree to
        these Terms.
      </p>

      <h2>1. Eligibility and account</h2>
      <p>
        You must be at least 16 years old to use Ornn. You are responsible
        for keeping your NyxID credentials secure. You are responsible for
        everything that happens under your account.
      </p>

      <h2>2. The Service</h2>
      <p>
        Ornn is a skill-lifecycle platform: a registry, runtime, and set
        of APIs for AI agents to discover, install, run, and publish
        skills. Features may evolve, and we may add, remove, or change
        functionality without notice.
      </p>

      <h2>3. Your content</h2>
      <p>
        You retain all ownership of skills, prompts, and other content you
        upload ("Your Content"). By using the Service, you grant Chrono AI
        a worldwide, non-exclusive, royalty-free license to host, store,
        index, transmit, audit, and display Your Content as needed to
        operate the Service and to make Your Content available to other
        users in accordance with the visibility settings you choose
        (private, shared, or public).
      </p>
      <p>
        You represent and warrant that you have the rights necessary to
        grant the above license, and that Your Content does not violate
        any third party's rights or applicable law.
      </p>

      <h2>4. Public skills</h2>
      <p>
        When you mark a skill as <strong>public</strong>, you grant other
        users a perpetual, worldwide, royalty-free license to access,
        download, install, and run that skill through the Service for
        their own use. If you later remove or unpublish a skill, copies
        already installed by other agents may continue to function.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Your use of the Service must comply with our{" "}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a>. We may
        suspend or terminate access to accounts or content that violates
        the policy.
      </p>

      <h2>6. Service availability</h2>
      <p>
        We provide the Service on an "as available" basis. We do not
        guarantee uninterrupted availability. We may perform maintenance
        with or without notice and may rate-limit, throttle, or suspend
        usage that materially impacts other users.
      </p>

      <h2>7. Quotas and fair use</h2>
      <p>
        Free-tier accounts are subject to monthly quotas (playground runs,
        skill-generation runs) administered through the Service. Quota
        resets, grants, and redemption codes are managed by Chrono AI at
        our discretion. Abuse of quota mechanisms — including using
        multiple accounts to circumvent limits — may result in account
        suspension.
      </p>

      <h2>8. Third-party integrations</h2>
      <p>
        The Service connects to third-party services (LLM providers,
        chrono-storage, chrono-sandbox, optionally to your own NyxID-bound
        services). Your use of those third-party services is governed by
        their own terms. We are not responsible for the availability,
        accuracy, or pricing of third-party services.
      </p>

      <h2>9. Fees</h2>
      <p>
        Ornn is currently free to use. If we introduce paid tiers, we
        will give you advance notice and an opportunity to review the
        applicable terms before any charge.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or
        terminate your access immediately, without notice, if we believe
        you have violated these Terms or our Acceptable Use Policy, or if
        we are required to do so by law. On termination, sections that by
        their nature should survive (Sections 3, 11, 12, 13, 14) will
        survive.
      </p>

      <h2>11. Disclaimer</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT
        WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING
        IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT. CHRONO AI MAKES NO WARRANTY THAT
        THE SERVICE WILL BE ERROR-FREE OR UNINTERRUPTED. SKILLS PUBLISHED
        BY OTHER USERS HAVE NOT BEEN VETTED BY US BEYOND OUR AUTOMATED
        SCAN; YOU INSTALL AND RUN THIRD-PARTY SKILLS AT YOUR OWN RISK.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, CHRONO AI'S TOTAL LIABILITY
        FOR ANY CLAIM ARISING OUT OF OR RELATED TO THE SERVICE IS LIMITED
        TO THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN
        THE 12 MONTHS BEFORE THE CLAIM, OR (B) USD 100. WE WILL NOT BE
        LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
        EXEMPLARY DAMAGES, INCLUDING LOST PROFITS OR DATA, EVEN IF WE
        WERE ADVISED OF THE POSSIBILITY.
      </p>

      <h2>13. Indemnification</h2>
      <p>
        You agree to defend and indemnify Chrono AI against any claim
        arising from (a) Your Content, (b) your violation of these Terms,
        or (c) your violation of any third-party right or applicable law.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These Terms are governed by the laws of Singapore, without regard
        to its conflict-of-law rules. Any dispute will be resolved in the
        courts of Singapore, and you consent to their jurisdiction.
      </p>

      <h2>15. Changes</h2>
      <p>
        We may revise these Terms by updating this page. Material changes
        will be communicated in-product or by email at least 14 days
        before they take effect. Your continued use of the Service after
        the effective date constitutes acceptance.
      </p>

      <h2>16. Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href="mailto:support@chrono-ai.fun">support@chrono-ai.fun</a>.
      </p>
    </LegalLayout>
  );
}
