/**
 * Framework Section Component.
 * Displays the Ornn framework overview with feature checklist and code snippet.
 * Two-column layout on desktop, stacked on mobile.
 * @module pages/landing/FrameworkSection
 */

import { motion } from "framer-motion";

interface Feature {
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    title: "Verifiable Execution",
    description: "Every skill runs in an isolated, auditable sandbox.",
  },
  {
    title: "Zero-Trust Registry",
    description: "Cryptographic signatures ensure skill integrity.",
  },
  {
    title: "Seamless SDK Integration",
    description: "One line to discover. One line to execute.",
  },
];

const CODE_SNIPPET = `import { Ornn } from '@ornn/sdk';

const ornn = new Ornn({ apiKey: 'your-key' });

// Discover skills
const skills = await ornn.discover({
  capability: 'code-execution',
  runtime: 'python3'
});

// Execute a skill
const result = await ornn.execute(skills[0], {
  code: 'print("Hello from Ornn!")'
});`;

export function FrameworkSection() {
  return (
    <section id="framework" className="px-4 py-20">
      <div className="max-w-[1280px] mx-auto">
        <div className="grid gap-12 lg:grid-cols-2 items-start">
          {/* Left column: description + features */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            {/* Section title */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-neon-cyan/30 bg-neon-cyan/10">
                <HammerIcon className="h-5 w-5 text-neon-cyan" />
              </div>
              <h2 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary tracking-wide">
                The Ornn Framework
              </h2>
            </div>

            {/* Description */}
            <p className="font-body text-text-muted leading-relaxed mb-8 max-w-lg">
              Ornn isn't just a list; it's a protocol. A standardized way for AI
              agents to discover, verify, and execute capabilities across any
              environment.
            </p>

            {/* Feature checklist */}
            <ul className="space-y-5">
              {FEATURES.map((feature, i) => (
                <motion.li
                  key={feature.title}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.1 }}
                  className="flex gap-3"
                >
                  <CheckCircle />
                  <div>
                    <p className="font-body text-base font-semibold text-text-primary">
                      {feature.title}
                    </p>
                    <p className="font-body text-sm text-text-muted">
                      {feature.description}
                    </p>
                  </div>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* Right column: code snippet */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <div className="glass rounded-xl overflow-hidden border border-neon-cyan/20">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-neon-cyan/10 px-4 py-3">
                <div className="h-3 w-3 rounded-full bg-neon-red/60" />
                <div className="h-3 w-3 rounded-full bg-neon-yellow/60" />
                <div className="h-3 w-3 rounded-full bg-neon-green/60" />
                <span className="ml-3 font-mono text-xs text-text-muted">
                  example.ts
                </span>
              </div>

              {/* Code content */}
              <pre className="overflow-x-auto p-5">
                <code className="font-mono text-sm leading-relaxed text-text-primary whitespace-pre">
                  {formatCode(CODE_SNIPPET)}
                </code>
              </pre>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/** Apply basic syntax coloring to the code snippet */
function formatCode(code: string): React.ReactNode {
  // Split into lines and apply simple coloring for keywords, strings, comments
  return code.split("\n").map((line, i) => (
    <span key={i}>
      {colorLine(line)}
      {"\n"}
    </span>
  ));
}

/** Color a single line with basic syntax highlighting */
function colorLine(line: string): React.ReactNode {
  if (line.startsWith("//")) {
    return <span className="text-text-muted">{line}</span>;
  }
  if (line.startsWith("import")) {
    return (
      <>
        <span className="text-neon-magenta">import</span>
        {colorStrings(line.slice(6))}
      </>
    );
  }
  if (line.startsWith("const")) {
    return (
      <>
        <span className="text-neon-magenta">const</span>
        {colorStrings(line.slice(5))}
      </>
    );
  }
  return colorStrings(line);
}

/** Highlight string literals in a line */
function colorStrings(text: string): React.ReactNode {
  const parts = text.split(/('.*?')/g);
  return parts.map((part, i) =>
    part.startsWith("'") ? (
      <span key={i} className="text-neon-green">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/** Hammer icon for the section title */
function HammerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 19.63L13.43 8.2l-1.72-1.72 2.83-2.83 5.65 5.66-2.83 2.82-1.72-1.72L4.22 21.77 2 19.63z" />
      <path d="M18.37 3.29l2.12 2.12-1.42 1.42-2.12-2.12 1.42-1.42z" />
    </svg>
  );
}

/** Orange check circle icon */
function CheckCircle() {
  return (
    <div className="mt-0.5 shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-neon-cyan/15 text-neon-cyan">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}
