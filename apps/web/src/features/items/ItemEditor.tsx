import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "@/lib/api";
import { useT } from "@/i18n";
import { ErrorBox, Modal, Spinner, toast } from "@/components/ui";
import ItemForm from "./ItemForm";
import type { ItemBody, ItemFull } from "./types";

/** Create (no itemId) or edit (itemId) an item inside a modal; loads the full item (with units) before editing. */
export function ItemEditor({ open, onClose, itemId }: { open: boolean; onClose: () => void; itemId?: string | undefined }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["items", itemId], queryFn: () => get<ItemFull>(`/items/${itemId ?? ""}`), enabled: open && itemId !== undefined });
  const m = useMutation({
    mutationFn: (body: ItemBody) => (itemId ? patch<{ id: string }>(`/items/${itemId}`, body) : post<{ id: string }>("/items", body)),
    onSuccess: () => { toast.ok(t(itemId ? "items.updated" : "items.created")); void qc.invalidateQueries({ queryKey: ["items"] }); onClose(); },
  });
  const body = itemId && q.isLoading ? <Spinner />
    : itemId && q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
    : <ItemForm key={itemId ? (q.data?.id ?? "loading") : "new"} initial={itemId ? q.data : undefined} onSubmit={(b) => m.mutate(b)} onCancel={onClose} submitting={m.isPending} error={m.error} />;
  return <Modal open={open} onClose={onClose} title={t(itemId ? "items.edit" : "items.new")} wide>{body}</Modal>;
}
