/**
 * Acceptable Use Policy.
 *
 * Tailored to a skill-marketplace context: user-uploaded code is the
 * primary risk surface, so the AUP leads with malicious-code rules,
 * follows with the AgentSeal scan disclosure + takedown process, and
 * closes with the standard SaaS abuse list.
 *
 * @module pages/legal/AcceptableUsePage
 */

import { LegalLayout } from "./LegalLayout";

export function AcceptableUsePage() {
  return (
    <LegalLayout
      eyebrow="[ § — ACCEPTABLE USE ]"
      title="Acceptable Use Policy"
      lastUpdatedIso="2026-05-08"
    >
      <p>
        This Acceptable Use Policy ("AUP") describes activities that are
        not permitted on Ornn (the "Service"). It applies to everything
        you upload, publish, run, or transmit through the Service. The
        AUP supplements our{" "}
        <a href="/legal/terms">Terms of Service</a> and{" "}
        <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>1. No malicious code</h2>
      <p>You may not upload, publish, or distribute a skill that:</p>
      <ul>
        <li>
          Contains viruses, worms, ransomware, cryptominers, droppers, or
          backdoors.
        </li>
        <li>
          Exfiltrates user data, agent prompts, or third-party
          credentials to an unauthorized destination.
        </li>
        <li>
          Performs network reconnaissance or attack actions (port scans,
          credential stuffing, denial-of-service, etc.) without a clear
          authorized purpose.
        </li>
        <li>
          Attempts to break out of the chrono-sandbox or escalate
          privileges in any execution environment.
        </li>
        <li>
          Uses obfuscation, dynamic-import gymnastics, or runtime code
          fetching specifically to evade our automated scan.
        </li>
      </ul>

      <h2>2. AgentSeal scanning</h2>
      <p>
        Every skill version you publish is automatically scanned by{" "}
        <strong>AgentSeal</strong>, our static analysis runner. The scan
        produces a verdict (Pass / Caution / Risk) and a numeric score
        from 0 to 10. Scan results are visible to consumers of your
        skill so they can decide whether to install it. We may decline
        to host, deprecate, or remove a skill if the scan surfaces
        unmitigated risk findings.
      </p>

      <h2>3. Content rules</h2>
      <p>You may not publish or transmit content that:</p>
      <ul>
        <li>Infringes third-party intellectual property or privacy.</li>
        <li>
          Is unlawful, defamatory, harassing, hateful, or directly
          incites violence.
        </li>
        <li>
          Sexualizes minors or contains other content prohibited by
          applicable law.
        </li>
        <li>Impersonates any person or organization.</li>
        <li>
          Is designed to mislead, scam, or fraudulently induce action by
          another user.
        </li>
      </ul>

      <h2>4. Service-integrity rules</h2>
      <p>You may not:</p>
      <ul>
        <li>
          Probe, scan, or test the vulnerability of the Service except
          through our coordinated security disclosure channel (
          <a href="mailto:security@chrono-ai.fun">security@chrono-ai.fun</a>).
        </li>
        <li>
          Circumvent rate limits, quota enforcement, or other usage
          controls.
        </li>
        <li>
          Use multiple accounts to evade restrictions or amplify quota.
        </li>
        <li>
          Resell, sublicense, or commercially redistribute the Service
          except as expressly permitted in writing.
        </li>
        <li>
          Scrape the Service in a way that materially burdens our
          infrastructure.
        </li>
      </ul>

      <h2>5. Prompt and model abuse</h2>
      <p>
        When using playground, skill generation, or any LLM-backed
        feature, you may not:
      </p>
      <ul>
        <li>
          Attempt to extract the underlying model's system prompts,
          weights, or training data.
        </li>
        <li>
          Use the Service to generate content that violates the model
          provider's usage policies.
        </li>
        <li>
          Generate sexual content involving minors, biological or chemical
          weapon instructions, or other categorically prohibited output.
        </li>
      </ul>

      <h2>6. Reporting and takedown</h2>
      <p>
        To report a skill or content that violates this policy, email{" "}
        <a href="mailto:abuse@chrono-ai.fun">abuse@chrono-ai.fun</a> with
        the skill name, version, and a description of the violation. For
        copyright (DMCA) claims, include all elements required under 17
        U.S.C. § 512(c)(3) and direct the notice to the same address with
        subject line "DMCA".
      </p>
      <p>
        We review reports promptly. We may remove or restrict access to
        offending content while we investigate. We will notify the
        publisher unless doing so would interfere with an active
        investigation or is prohibited by law.
      </p>

      <h2>7. Enforcement</h2>
      <p>
        Violations may result in any of: warning, content removal,
        skill deprecation, account suspension, account termination,
        and — for unlawful activity — referral to authorities. We choose
        the response we consider proportionate.
      </p>

      <h2>8. Updates</h2>
      <p>
        We may update this AUP as the Service evolves and new abuse
        patterns emerge. We will publish material changes here and update
        the "Last updated" date.
      </p>

      <h2>9. Contact</h2>
      <p>
        Abuse reports:{" "}
        <a href="mailto:abuse@chrono-ai.fun">abuse@chrono-ai.fun</a>
        <br />
        Security disclosures:{" "}
        <a href="mailto:security@chrono-ai.fun">security@chrono-ai.fun</a>
        <br />
        General legal:{" "}
        <a href="mailto:legal@chrono-ai.fun">legal@chrono-ai.fun</a>
      </p>
    </LegalLayout>
  );
}
