import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { usePrefs, type Theme, type Digits, type Density } from "@/lib/prefs";
import { ErrorBox, PageHeader, Spinner, toast } from "@/components/ui";
import { useFeatureT } from "@/features/users/featureT";
import { settingsAr, settingsEn } from "./settings.keys";

const VERSION = (import.meta.env["VITE_APP_VERSION"] as string | undefined) ?? "dev";

function download(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pharmacore-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function SettingsPage() {
  const { t, locale } = useFeatureT(settingsAr, settingsEn);
  const setLocale = useAuth((s) => s.setLocale);
  const prefs = usePrefs();
  const Seg = <V extends string>({ id, value, options, onChange }: { id: string; value: V; options: Array<[V, string]>; onChange: (v: V) => void }) => (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1" role="radiogroup" aria-labelledby={id}>
      {options.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`min-h-[2.25rem] rounded-md px-3 text-sm font-medium transition ${value === v ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900"}`}>{label}</button>)}
    </div>
  );
  const me = useQuery({ queryKey: ["auth", "me"], queryFn: () => get<Me>("/auth/me") });
  const [unavailable, setUnavailable] = useState(false);
  const backup = useMutation({
    mutationFn: () => get<unknown>("/backup/export"),
    onSuccess: (d) => { download(d); toast.ok(t("set.backupDone")); },
    onError: (e: Error) => { if (e instanceof ApiError && (e.status === 404 || e.status === 501)) setUnavailable(true); else toast.err(e.message); },
  });
  const Row = ({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) => <tr><th className="w-48 text-start">{k}</th><td dir={ltr ? "ltr" : undefined} className={ltr ? "num" : undefined}>{v}</td></tr>;

  return (
    <div className="grid gap-4">
      <PageHeader title={t("nav.settings")} />
      <section className="card" aria-labelledby="set-acc">
        <h2 id="set-acc" className="mb-2 font-semibold">{t("set.account")}</h2>
        {me.isLoading ? <Spinner /> : me.error ? <ErrorBox error={me.error} onRetry={() => void me.refetch()} /> : me.data && (
          <table><tbody>
            <Row k={t("set.username")} v={me.data.username} ltr />
            <Row k={t("set.displayName")} v={me.data.displayName} />
            <Row k={t("set.tenantId")} v={me.data.tenantId} ltr />
            <Row k={t("set.permissions")} v={me.data.permissions.includes("*") ? t("set.allPerms") : String(me.data.permissions.length)} />
          </tbody></table>
        )}
      </section>
      <section className="card" aria-labelledby="set-prefs">
        <h2 id="set-prefs" className="mb-1 font-semibold">{t("set.prefs")}</h2>
        <p className="mb-4 text-sm text-ink-500">{t("set.prefsDesc")}</p>
        <dl className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-center">
          <dt id="set-lang" className="text-sm font-semibold text-ink-700">{t("set.language")}</dt>
          <dd><Seg id="set-lang" value={locale} options={[["ar", t("set.lang.ar")], ["en", t("set.lang.en")]]} onChange={(l) => setLocale(l)} /></dd>
          <dt id="set-theme" className="text-sm font-semibold text-ink-700">{t("set.theme")}</dt>
          <dd><Seg<Theme> id="set-theme" value={prefs.theme} options={[["system", t("set.theme.system")], ["light", t("set.theme.light")], ["dark", t("set.theme.dark")]]} onChange={prefs.setTheme} /></dd>
          <dt id="set-digits" className="text-sm font-semibold text-ink-700">{t("set.digits")}</dt>
          <dd><Seg<Digits> id="set-digits" value={prefs.digits} options={[["latn", "0123456789"], ["arab", "٠١٢٣٤٥٦٧٨٩"]]} onChange={prefs.setDigits} /><p className="mt-1 text-xs text-ink-500">{t("set.digitsHint")}</p></dd>
          <dt id="set-density" className="text-sm font-semibold text-ink-700">{t("set.density")}</dt>
          <dd><Seg<Density> id="set-density" value={prefs.density} options={[["comfortable", t("set.density.comfortable")], ["compact", t("set.density.compact")]]} onChange={prefs.setDensity} /></dd>
        </dl>
      </section>
      <section className="card" aria-labelledby="set-bk">
        <h2 id="set-bk" className="mb-2 font-semibold">{t("set.backup")}</h2>
        <p className="mb-2 text-sm text-ink-600">{t("set.backupDesc")}</p>
        {unavailable ? <p role="note" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">{t("set.backupUnavailable")}</p>
          : <button className="btn-primary" disabled={backup.isPending} onClick={() => backup.mutate()}>{backup.isPending ? t("common.loading") : t("set.backupRun")}</button>}
      </section>
      <section className="card" aria-labelledby="set-about">
        <h2 id="set-about" className="mb-2 font-semibold">{t("set.about")}</h2>
        <p className="text-sm">{t("app.name")} — {t("set.aboutText")}</p>
        <p className="text-sm text-ink-500">{t("set.version")}: <span className="num">{VERSION}</span></p>
      </section>
    </div>
  );
}
