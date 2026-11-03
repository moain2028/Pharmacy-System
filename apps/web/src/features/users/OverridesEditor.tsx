import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "@/lib/api";
import { ErrorBox, Field, Modal, Spinner, toast } from "@/components/ui";
import { groupPerms, useUT, type UserRow } from "./types";

interface Ov { effect: "ALLOW" | "DENY"; limit: string }
interface OverrideDto { permission: string; effect: "ALLOW" | "DENY"; limitValue?: number | undefined }

export function OverridesEditor({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useUT();
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => get<string[]>("/auth/permissions"), staleTime: Infinity });
  const [map, setMap] = useState<Record<string, Ov>>({});
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return groupPerms((perms.data ?? []).filter((p) => !f || p.toLowerCase().includes(f)));
  }, [perms.data, filter]);

  const m = useMutation({
    mutationFn: (overrides: OverrideDto[]) => put<unknown>(`/users/${user.id}/overrides`, { overrides }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["users"] }); toast.ok(t("users.saved")); onClose(); },
    onError: (e: Error) => toast.err(e.message),
  });

  const setEffect = (p: string, v: string) => setMap((prev) => {
    if (v === "ALLOW" || v === "DENY") return { ...prev, [p]: { effect: v, limit: prev[p]?.limit ?? "" } };
    return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== p));
  });
  const setLimit = (p: string, limit: string) => setMap((prev) => { const o = prev[p]; return o ? { ...prev, [p]: { ...o, limit } } : prev; });

  const save = () => {
    const out: OverrideDto[] = [];
    for (const [permission, o] of Object.entries(map)) {
      const l = o.limit.trim();
      if (l && !/^-?\d{1,12}$/.test(l)) { setErr(t("users.err.limit", { perm: permission })); return; }
      out.push(l ? { permission, effect: o.effect, limitValue: Number(l) } : { permission, effect: o.effect });
    }
    setErr(null);
    m.mutate(out);
  };

  return (
    <Modal open wide onClose={onClose} title={t("users.overridesTitle", { name: user.display_name })}
      footer={<><button className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button><button className="btn-primary" disabled={m.isPending} onClick={save}>{t("common.save")}</button></>}>
      <p className="mb-2 text-xs text-ink-500">{t("users.overridesNote")}</p>
      {err && <p role="alert" className="mb-2 rounded-md bg-danger-50 p-2 text-sm text-danger-700">{err}</p>}
      <Field label={t("users.filterPerms")}><input className="input" dir="ltr" autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} /></Field>
      {perms.isLoading ? <Spinner /> : perms.error ? <ErrorBox error={perms.error} /> : groups.map(([g, list]) => (
        <details key={g} className="mt-2 rounded-md border border-ink-200 p-2" open={!!filter}>
          <summary className="cursor-pointer font-medium" dir="ltr">{g} <span className="num text-xs text-ink-500">({list.filter((p) => map[p]).length}/{list.length})</span></summary>
          <table className="mt-2"><tbody>
            {list.map((p) => {
              const o = map[p];
              return (
                <tr key={p}>
                  <td dir="ltr" className="text-sm">{p}</td>
                  <td><select aria-label={p} className="input" value={o?.effect ?? ""} onChange={(e) => setEffect(p, e.target.value)}>
                    <option value="">{t("users.inherit")}</option><option value="ALLOW">{t("users.allow")}</option><option value="DENY">{t("users.deny")}</option>
                  </select></td>
                  <td><input aria-label={`${t("users.limit")} ${p}`} placeholder={t("users.limit")} className="input num w-28" inputMode="numeric" disabled={!o} value={o?.limit ?? ""} onChange={(e) => setLimit(p, e.target.value)} /></td>
                </tr>
              );
            })}
          </tbody></table>
        </details>
      ))}
    </Modal>
  );
}
