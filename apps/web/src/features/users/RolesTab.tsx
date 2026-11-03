import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { Empty, ErrorBox, Field, Modal, Spinner, toast } from "@/components/ui";
import { groupPerms, listOf, useUT, type RoleRow } from "./types";

export default function RolesTab() {
  const { t, locale } = useUT();
  const q = useQuery({ queryKey: ["roles"], queryFn: () => get<RoleRow[] | { rows?: RoleRow[] }>("/roles") });
  const [open, setOpen] = useState(false);
  const rows = listOf(q.data);
  return (
    <div className="card">
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setOpen(true)}>{t("users.role.new")}</button></div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? <Empty /> : (
        <table>
          <thead><tr><th>{t("users.role.code")}</th><th>{t("users.role.name")}</th><th>{t("users.role.count")}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td dir="ltr">{r.code}</td><td>{locale === "ar" ? r.name_ar : r.name_en}</td><td className="num">{r.permissions.includes("*") ? "*" : r.permissions.length}</td></tr>
          ))}</tbody>
        </table>
      )}
      {open && <RoleForm onClose={() => setOpen(false)} />}
    </div>
  );
}

function RoleForm({ onClose }: { onClose: () => void }) {
  const { t } = useUT();
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => get<string[]>("/auth/permissions"), staleTime: Infinity });
  const groups = useMemo(() => groupPerms(perms.data ?? []), [perms.data]);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => post<unknown>("/roles", { code, nameAr: nameAr.trim(), nameEn: nameEn.trim(), permissions: sel, limits: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["roles"] }); toast.ok(t("users.role.saved")); onClose(); },
    onError: (e: Error) => toast.err(e.message),
  });

  const toggle = (p: string) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  const toggleGroup = (list: string[], on: boolean) => setSel((s) => (on ? [...new Set([...s, ...list])] : s.filter((x) => !list.includes(x))));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z0-9_]{2,40}$/.test(code)) { setErr(t("users.role.err.code")); return; }
    if (!nameAr.trim() || !nameEn.trim()) { setErr(t("users.role.err.name")); return; }
    setErr(null);
    m.mutate();
  };

  return (
    <Modal open wide onClose={onClose} title={t("users.role.new")}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button><button type="submit" form="role-form" className="btn-primary" disabled={m.isPending}>{t("common.save")}</button></>}>
      <form id="role-form" onSubmit={submit} noValidate className="grid gap-3">
        {err && <p role="alert" className="rounded-md bg-danger-50 p-2 text-sm text-danger-700">{err}</p>}
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("users.role.code")}><input className="input" dir="ltr" autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <Field label={t("users.role.nameAr")}><input className="input" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></Field>
          <Field label={t("users.role.nameEn")}><input className="input" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></Field>
        </div>
        <div className="label">{t("users.role.permissions")} <span className="num">({sel.length})</span></div>
        {perms.isLoading ? <Spinner /> : perms.error ? <ErrorBox error={perms.error} /> : (
          <div className="grid gap-2 md:grid-cols-2">
            {groups.map(([g, list]) => {
              const all = list.every((p) => sel.includes(p));
              return (
                <fieldset key={g} className="rounded-md border border-ink-200 p-2">
                  <legend className="px-1"><label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={all} onChange={(e) => toggleGroup(list, e.target.checked)} /><span dir="ltr">{g}</span></label></legend>
                  {list.map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(p)} onChange={() => toggle(p)} /><span dir="ltr">{p}</span></label>)}
                </fieldset>
              );
            })}
          </div>
        )}
      </form>
    </Modal>
  );
}
