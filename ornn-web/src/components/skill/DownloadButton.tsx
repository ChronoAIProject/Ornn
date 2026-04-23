import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/utils/formatters";

export interface DownloadButtonProps {
  skillId: string;
  version: string;
  downloadCount: number;
  className?: string;
}

export function DownloadButton({ skillId, version, downloadCount, className = "" }: DownloadButtonProps) {
  const handleDownload = () => {
    window.open(`/api/v1/skills/${skillId}/versions/${version}/download`, "_blank");
  };

  return (
    <Button onClick={handleDownload} className={`w-full ${className}`}>
      Download v{version}
      <span className="ml-2 text-xs opacity-60">({formatNumber(downloadCount)})</span>
    </Button>
  );
}
