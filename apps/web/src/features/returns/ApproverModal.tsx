import { useState } from "react";
import { useT } from "@/i18n";
import { Field, Modal } from "@/components/ui";
import type { Approver } from "./types";

interface Props { open: boolean; message: string; busy: boolean; onClose: () => void; onSubmit: (a: Approver) => void }

export function ApproverModal({ open, message, busy, onClose, onSubmit }: Props) {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const ok = username.trim() !== "" && secret !== "" && !busy;
  return (
    <Modal open={open} onClose={onClose} title={t("auth.approver")} footer={<>
      <button className="btn-secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
      <button className="btn-primary" form="approver-form" type="submit" disabled={!ok}>{t("ret.approve")}</button>
    </>}>
      <div role="alert" className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{t("ret.needApproval")}<div className="text-xs">{message}</div></div>
      <form id="approver-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit({ username: username.trim(), secret }); }}>
        <Field label={t("auth.username")}><input className="input" autoFocus autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label={t("auth.approverSecret")}><input className="input num" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
