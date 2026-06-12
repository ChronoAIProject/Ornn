/** Format a number with commas */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Format file size in bytes to human-readable */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format an ISO date to an exact Asia/Singapore timestamp in the active UI locale (#752). */
export function formatDateSGT(dateStr: string, lang?: string, opts?: { withSeconds?: boolean }): string {
  const locale = lang === "zh" ? "zh-CN" : "en-SG"; // zh→zh-CN (NewsPage precedent); en→en-SG preserves current output
  return new Date(dateStr).toLocaleString(locale, {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(opts?.withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  });
}
