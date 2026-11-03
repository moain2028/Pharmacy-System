import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { Badge, Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { listOf, useUT, type UserRow } from "./types";
import { UserForm } from "./UserForm";
import { OverridesEditor } from "./OverridesEditor";
import RolesTab from "./RolesTab";

export default function UsersPage() {
  const { t } = useUT();
  const [tab, setTab] = useState<"users" | "roles">("users");
  return (
    <div>
      <PageHeader title={t("users.title")} />
      <div role="tablist" className="mb-3 flex gap-2">
        {(["users", "roles"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "btn-primary" : "btn-secondary"} onClick={() => setTab(k)}>{t(`users.tab.${k}`)}</button>
        ))}
      </div>
      {tab === "users" ? <UsersList /> : <RolesTab />}
    </div>
  );
}

function UsersList() {
  const { t } = useUT();
  const q = useQuery({ queryKey: ["users"], queryFn: () => get<UserRow[] | { rows?: UserRow[] }>("/users") });
  // undefined = closed, null = creating, row = editing
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const [ov, setOv] = useState<UserRow | null>(null);
  const rows = listOf(q.data);
  return (
    <div className="card">
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setEditing(null)}>{t("users.new")}</button></div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? <Empty /> : (
        <table>
          <thead><tr><th>{t("users.username")}</th><th>{t("users.displayName")}</th><th>{t("users.roles")}</th><th>{t("users.locale")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td dir="ltr">{u.username}</td>
                <td>{u.display_name}</td>
                <td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="blue">{r.code}</Badge>)}</div></td>
                <td>{t(`users.lang.${u.locale}`)}</td>
                <td>{u.is_active ? <Badge tone="green">{t("common.active")}</Badge> : <Badge tone="red">{t("common.inactive")}</Badge>}</td>
                <td className="flex gap-2">
                  <button className="btn-secondary" onClick={() => setEditing(u)}>{t("common.edit")}</button>
                  <button className="btn-secondary" onClick={() => setOv(u)}>{t("users.overrides")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== undefined && <UserForm key={editing?.id ?? "new"} user={editing} onClose={() => setEditing(undefined)} />}
      {ov && <OverridesEditor key={ov.id} user={ov} onClose={() => setOv(null)} />}
    </div>
  );
}
