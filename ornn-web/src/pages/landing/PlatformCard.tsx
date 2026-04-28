/**
 * Single platform tile inside the install-anywhere grid.
 */
export function PlatformCard({
  num,
  name,
  path,
  status,
}: {
  num: string;
  name: string;
  path: string;
  status: string;
}) {
  return (
    <div className="bg-obsidian px-6 py-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-meta">
        {num}
      </div>
      <div className="my-2 font-display text-[26px] font-light tracking-[-0.015em] text-parchment">
        {name}
      </div>
      <div className="font-mono text-[11px] text-bone">{path}</div>
      <div className="mt-3.5 font-mono text-[11px] tracking-[0.04em] text-ember">
        {status}
      </div>
    </div>
  );
}
