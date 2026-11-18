import type { NyxidSection, SectionId } from "../../domains/settings/sections";
import { NyxidSaTokenProvider } from "./base";
import { NyxidServiceClient } from "./service";

interface IntegrationSettings {
  getNyxid(): Promise<NyxidSection>;
  invalidateCache(id?: SectionId): void;
  onSectionSaved(listener: (id: SectionId) => void): void;
}

/** Shared lifecycle for settings-derived credentials and downstream caches. */
export function createNyxidIntegration(settings: IntegrationSettings) {
  const saTokenProvider = new NyxidSaTokenProvider(async () => {
    const s = await settings.getNyxid();
    return { tokenUrl: s.tokenUrl, clientId: s.clientId, clientSecret: s.clientSecret };
  }, () => settings.invalidateCache("nyxid"));
  const nyxidConfigResolver = async () => ({
    baseApiUrl: (await settings.getNyxid()).baseApiUrl,
  });
  const nyxidServiceClient = new NyxidServiceClient({
    resolver: nyxidConfigResolver,
    saTokenProvider,
  });
  settings.onSectionSaved((id) => {
    if (id !== "nyxid") return;
    saTokenProvider.invalidate();
    nyxidServiceClient.invalidateCache();
  });
  return { saTokenProvider, nyxidConfigResolver, nyxidServiceClient };
}
