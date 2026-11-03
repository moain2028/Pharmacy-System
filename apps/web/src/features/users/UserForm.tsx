import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "@/lib/api";
import type { Locale } from "@/lib/auth";
import { ErrorBox, Field, Modal, Spinner, toast } from "@/components/ui";
import { listOf, useUT, type RoleRow, type UserRow } from "./types";

export function UserForm({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const { t, locale } = useUT();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => get<RoleRow[] | { rows?: RoleRow[] }>("/roles") });
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [loc, setLoc] = useState<Locale>(user?.locale ?? "ar");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [roleIds, setRoleIds] = useState<string[]>(user?.roles.map((r) => r.id) ?? []);
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => (user ? patch<unknown>(`/users/${user.id}`, body) : post<unknown>("/users", body)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["users"] }); toast.ok(t("users.saved")); onClose(); },
    onError: (e: Error) => toast.err(e.message),
  });

  const validate = (): string | null => {
    if (!user && !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) return t("users.err.username");
    if (!displayName.trim()) return t("users.err.displayName");
    if ((!user || password) && (password.length < 8 || password.length > 256)) return t("users.err.password");
    if (pin && !/^\d{4,12}$/.test(pin)) return t("users.err.pin");
    if (roleIds.length === 0) return t("users.err.roles");
    return null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    setErr(v);
    if (v) return;
    const extra = { ...(pin ? { pin } : {}), ...(password ? { password } : {}) };
    if (user) m.mutate({ displayName: displayName.trim(), locale: loc, isActive: active, roleIds, ...extra });
    else m.mutate({ username, displayName: displayName.trim(), password, locale: loc, roleIds, ...(pin ? { pin } : {}) });
  };

  const toggleRole = (id: string) => setRoleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Modal open onClose={onClose} title={user ? t("users.edit") : t("users.new")}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button><button type="submit" form="user-form" className="btn-primary" disabled={m.isPending}>{t("common.save")}</button></>}>
      <form id="user-form" className="grid gap-3" onSubmit={submit} noValidate>
        {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        <Field label={t("users.username")}>
          <input className="input" dir="ltr" autoFocus={!user} disabled={!!user} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t("users.displayName")}>
          <input className="input" autoFocus={!!user} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label={t("users.password")} {...(user ? { hint: t("users.passwordHintEdit") } : {})}>
          <input className="input" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("users.pin")} hint={t("users.pinHint")}>
            <input className="input num" inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label={t("users.locale")}>
            <select className="input" value={loc} onChange={(e) => setLoc(e.target.value === "en" ? "en" : "ar")}>
              <option value="ar">{t("users.lang.ar")}</option><option value="en">{t("users.lang.en")}</option>
            </select>
          </Field>
        </div>
        {user && <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>{t("users.active")}</span></label>}
        <fieldset className="rounded-md border border-slate-200 p-2">
          <legend className="label px-1">{t("users.roles")}</legend>
          {roles.isLoading ? <Spinner /> : roles.error ? <ErrorBox error={roles.error} /> : (
            <div className="grid grid-cols-2 gap-1">
              {listOf(roles.data).map((r) => (
                <label key={r.id} className="flex items-center gap-2"><input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} /><span>{locale === "ar" ? r.name_ar : r.name_en}</span></label>
              ))}
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
