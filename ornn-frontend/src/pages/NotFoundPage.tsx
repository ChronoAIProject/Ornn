import { useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <PageTransition>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="neon-magenta mb-4 font-heading text-6xl font-bold text-neon-magenta">404</h1>
        <p className="mb-8 font-body text-lg text-text-muted">
          This sector of the grid does not exist.
        </p>
        <Button onClick={() => navigate("/")}>Return to Forge</Button>
      </div>
    </PageTransition>
  );
}
