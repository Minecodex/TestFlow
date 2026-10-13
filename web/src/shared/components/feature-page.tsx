import { Button } from "@heroui/react";
import { CircleDashed } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMessages, type FeatureId } from "../../i18n";

export function FeaturePage({ feature }: { feature: FeatureId }) {
  const t = useMessages();
  const navigate = useNavigate();
  return (
    <div className="testflow-page">
      <header className="testflow-page-heading">
        <div>
          <h1>{t[feature].title}</h1>
          <p>{t[feature].description}</p>
        </div>
      </header>
      <section className="testflow-panel testflow-empty-state">
        <CircleDashed aria-hidden="true" />
        <h2>{t.common.planned}</h2>
        <p>{t.common.plannedDescription}</p>
        <Button variant="secondary" onPress={() => navigate("/")}>
          {t.common.back}
        </Button>
      </section>
    </div>
  );
}
