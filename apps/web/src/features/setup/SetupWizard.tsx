import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { post } from "@/lib/api";
import { useT } from "@/i18n";
import { ErrorBox, Field } from "@/components/ui";

const CURRENCIES = ["YER_NEW", "YER_OLD", "SAR", "USD"];

export default function SetupWizard() {
  const { t } = useT(); const nav = useNavigate();
  const [step, setStep] = useState(0); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ nameAr: "", nameEn: "", baseCurrency: "YER_NEW", username: "owner", displayName: "", password: "", pin: "" });
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function finish(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post("/setup/initialize", { pharmacy: { nameAr: f.nameAr, nameEn: f.nameEn || f.nameAr, baseCurrency: f.baseCurrency }, owner: { username: f.username, displayName: f.displayName || f.username, password: f.password, pin: f.pin || undefined } });
      setStep(2);
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <form onSubmit={finish} className="card w-full max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">{t("setup.title")}</h1>
        <ol className="flex gap-2 text-xs">{[t("setup.pharmacy"), t("setup.owner"), t("setup.done")].map((s, i) => <li key={s} className={`rounded-full px-3 py-1 ${i === step ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{i + 1}. {s}</li>)}</ol>
        {step === 0 && <>
          <Field label={`${t("setup.pharmacy")} (ar)`}><input className="w-full" value={f.nameAr} onChange={up("nameAr")} required /></Field>
          <Field label={`${t("setup.pharmacy")} (en)`}><input className="w-full" value={f.nameEn} onChange={up("nameEn")} /></Field>
          <Field label={t("setup.currency")}><select className="w-full" value={f.baseCurrency} onChange={up("baseCurrency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <div className="flex justify-end"><button type="button" className="btn-primary" disabled={!f.nameAr} onClick={() => setStep(1)}>{t("common.next")}</button></div>
        </>}
        {step === 1 && <>
          <Field label={t("auth.username")}><input className="w-full" value={f.username} onChange={up("username")} required /></Field>
          <Field label={t("setup.owner")}><input className="w-full" value={f.displayName} onChange={up("displayName")} /></Field>
          <Field label={t("auth.password")} hint="≥ 8"><input type="password" className="w-full" value={f.password} onChange={up("password")} minLength={8} required /></Field>
          <Field label={t("auth.pin")}><input inputMode="numeric" className="w-full" value={f.pin} onChange={up("pin")} pattern="\d{4,12}" /></Field>
          {err !== null && <ErrorBox error={err} />}
          <div className="flex justify-between"><button type="button" className="btn-secondary" onClick={() => setStep(0)}>{t("common.back")}</button><button className="btn-primary" disabled={busy}>{t("common.confirm")}</button></div>
        </>}
        {step === 2 && <div className="space-y-3 text-center"><div className="text-3xl">✅</div><div>{t("setup.done")}</div><button type="button" className="btn-primary" onClick={() => nav("/login")}>{t("auth.signIn")}</button></div>}
      </form>
    </div>
  );
}
