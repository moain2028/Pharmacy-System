import { useT } from "@/i18n";
export default function Placeholder() {
  const { t } = useT();
  return <div className="card text-sm text-slate-500">{t("common.loading")}</div>;
}
