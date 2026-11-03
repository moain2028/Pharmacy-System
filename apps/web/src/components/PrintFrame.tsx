import { type ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";

interface SetupStatus { tenants: Array<{ id: string; nameAr: string; nameEn: string }> }

/**
 * Print document frame: appears ONLY in print (screen shows children untouched).
 * Header: pharmacy name, document title, period/filters, printed-by + timestamp. Footer: page x / y via CSS counters.
 * Sets <title> while mounted so the browser's PDF filename / header matches the report.
 */
export function PrintFrame({ title, period, children, landscape = false }: { title: string; period?: string | undefined; children: ReactNode; landscape?: boolean }) {
  const { t, locale } = useT();
  const { me } = useAuth();
  const st = useQuery({ queryKey: ["setup-status"], queryFn: () => get<SetupStatus>("/setup/status"), staleTime: 5 * 60_000 });
  // Defensive: this is a print adornment and must never break a report if the status payload is partial/mocked.
  const tenants = Array.isArray(st.data?.tenants) ? st.data.tenants : [];
  const tenant = tenants.find((x) => x.id === me?.tenantId) ?? tenants[0];
  const pharmacy = tenant ? (locale === "ar" ? tenant.nameAr : tenant.nameEn) : "";
  useEffect(() => { const prev = document.title; document.title = `${pharmacy ? pharmacy + " — " : ""}${title}`; return () => { document.title = prev; }; }, [pharmacy, title]);
  const now = new Date();
  return (
    <div className={`print-doc ${landscape ? "print-landscape" : ""}`} data-print-title={title}>
      <header className="print-only print-header">
        <div className="print-brand">
          <div className="print-pharmacy">{pharmacy || "PharmaCore"}</div>
          <div className="print-title">{title}</div>
        </div>
        <dl className="print-meta">
          {period && <><dt>{t("print.period")}</dt><dd className="num">{period}</dd></>}
          <dt>{t("print.printedAt")}</dt><dd className="num">{now.toLocaleString(locale === "ar" ? "ar-YE-u-nu-latn" : "en-GB")}</dd>
          <dt>{t("print.printedBy")}</dt><dd>{me?.displayName ?? me?.username ?? ""}</dd>
        </dl>
      </header>
      {children}
      <footer className="print-only print-footer"><span>{pharmacy} · PharmaCore</span><span className="print-page" /></footer>
    </div>
  );
}
