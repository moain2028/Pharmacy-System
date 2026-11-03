import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { post, get, type ApiError } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { useT } from "@/i18n";
import { ErrorBox, Field } from "@/components/ui";
import { Icons } from "@/components/icons";

interface LoginRes { accessToken: string; refreshToken: string }
interface SetupStatus { initialized: boolean; demo?: boolean }
/** Shown only when the server runs with DEMO_MODE=true (trial installs). */
const DEMO_ACCOUNTS = [{ u: "1", p: "1", roleKey: "auth.demoOwner" }, { u: "2", p: "2", roleKey: "auth.demoCashier" }] as const;

export default function LoginPage() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const { setTokens, setMe, setLocale } = useAuth();
  const [username, setU] = useState(""); const [password, setP] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const status = useQuery({ queryKey: ["setup-status"], queryFn: () => get<SetupStatus>("/setup/status"), staleTime: 60_000 });

  async function login(u: string, p: string) {
    setBusy(true); setErr(null);
    try {
      const r = await post<LoginRes>("/auth/login", { username: u, password: p });
      setTokens(r.accessToken, r.refreshToken);
      const me = await get<Me>("/auth/me");
      setMe(me);
      nav("/", { replace: true });
    } catch (ex) { setErr(ex as ApiError); } finally { setBusy(false); }
  }
  function submit(e: FormEvent) { e.preventDefault(); void login(username, password); }
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-brand-800 text-white lg:flex lg:flex-col lg:justify-between lg:p-12" aria-hidden="true">
        <div className="absolute -start-24 -top-24 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="absolute -bottom-32 -end-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20"><Icons.pill className="h-6 w-6" /></span><span className="text-xl font-extrabold">{t("app.name")}</span></div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-4xl font-extrabold leading-tight text-white">{t("auth.heroTitle")}</h2>
          <p className="text-base text-brand-100">{t("auth.heroBody")}</p>
          <ul className="grid grid-cols-2 gap-2 pt-2 text-sm text-brand-50">
            {["auth.feat1", "auth.feat2", "auth.feat3", "auth.feat4"].map((k) => <li key={k} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/10"><Icons.check className="h-4 w-4 text-brand-200" />{t(k)}</li>)}
          </ul>
        </div>
        <div className="relative text-xs text-brand-200">© {new Date().getFullYear()} PharmaCore</div>
      </aside>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-ink-50 px-4 py-8 sm:px-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 animate-fade-up" aria-label={t("auth.title")}>
          <div className="flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white"><Icons.pill className="h-5 w-5" /></span><span className="text-lg font-extrabold text-ink-900">{t("app.name")}</span></div>
          </div>
          <div>
            <h1 className="text-2xl">{t("auth.title")}</h1>
            <p className="mt-1 text-sm text-ink-500">{t("auth.subtitle")}</p>
          </div>
          <div className="card space-y-4">
            <Field label={t("auth.username")}><input autoFocus autoComplete="username" inputMode="text" value={username} onChange={(e) => setU(e.target.value)} required /></Field>
            <Field label={t("auth.password")}><input type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required /></Field>
            {err !== null && <ErrorBox error={err} />}
            <button className="btn-primary w-full" disabled={busy}>{busy ? t("common.loading") : t("auth.signIn")}</button>
          </div>
          {status.data?.demo && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="demo-login">
              <div className="mb-2 flex items-center gap-2 font-semibold text-amber-900"><Icons.alert className="h-4 w-4" />{t("auth.demoTitle")}</div>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.u} type="button" className="btn-secondary" disabled={busy} onClick={() => void login(a.u, a.p)}>
                    {t(a.roleKey)} <span className="num text-xs text-ink-500">({a.u}/{a.p})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-ink-500">
            <button type="button" className="btn-ghost btn-sm -ms-2" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}><Icons.globe className="h-4 w-4" />{t("nav.language")}</button>
            <span className="num">v1.0</span>
          </div>
        </form>
      </div>
    </div>
  );
}
