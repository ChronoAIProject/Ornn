/**
 * Landing Page Footer Component.
 * Simple centered footer with copyright and glass morphism top border.
 * Shows frontend version (build-time) and backend version (fetched from /health).
 * @module pages/landing/LandingFooter
 */

import { useState, useEffect } from "react";
import { config } from "@/config";

const API_BASE = config.apiBaseUrl;

export function LandingFooter() {
  const year = new Date().getFullYear();
  const [backendVersion, setBackendVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((data: { version?: string }) => {
        if (data.version) setBackendVersion(data.version);
      })
      .catch(() => { /* ignore — footer is non-critical */ });
  }, []);

  return (
    <footer className="border-t border-neon-cyan/10 px-4 py-8">
      <div className="max-w-[1280px] mx-auto text-center">
        <p className="font-body text-sm text-text-muted">
          {year} Ornn. All rights reserved.
        </p>
        <p className="font-body text-xs text-text-muted/50 mt-1">
          frontend v{__APP_VERSION__}
          {backendVersion && <> · backend v{backendVersion}</>}
        </p>
      </div>
    </footer>
  );
}
