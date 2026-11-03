import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { post, get, type ApiError } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { useT } from "@/i18n";
import { ErrorBox, Field } from "@/components/ui";

interface LoginRes { accessToken: string; refreshToken: string }

export default function LoginPage() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const { setTokens, setMe, setLocale } = useAuth();
  const [username, setU] = useState(""); const [password, setP] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await post<LoginRes>("/auth/login", { username, password });
      setTokens(r.accessToken, r.refreshToken);
      const me = await get<Me>("/auth/me");
      setMe(me);
      nav("/", { replace: true });
    } catch (ex) { setErr(ex as ApiError); } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4" aria-label={t("auth.title")}>
        <div className="flex items-center justify-between"><h1 className="text-2xl font-bold text-brand-700">{t("app.name")}</h1>
          <button type="button" className="text-xs text-slate-500 underline" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{t("nav.language")}</button></div>
        <h2 className="text-lg font-semibold">{t("auth.title")}</h2>
        <Field label={t("auth.username")}><input autoFocus autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} className="w-full" required /></Field>
        <Field label={t("auth.password")}><input type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} className="w-full" required /></Field>
        {err !== null && <ErrorBox error={err} />}
        <button className="btn-primary w-full" disabled={busy}>{t("auth.signIn")}</button>
      </form>
    </div>
  );
}
