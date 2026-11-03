import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { translate } from "@/i18n";
import { get, post } from "@/lib/api";
import InventoryPage from "./index";

vi.mock("@/lib/api", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/api")>();
  return { ...m, get: vi.fn(), post: vi.fn() };
});

const tr = (k: string) => translate("ar", k);
const P = { id: "i1", code: "P001", trade_name_ar: "باراسيتامول", trade_name_en: "Paracetamol" };
const LOCS = [{ id: "L1", code: "MAIN", name_ar: "المستودع", name_en: "Warehouse" }];
const ITEM = { ...P, units: [
  { id: "u1", name_ar: "حبة", name_en: "Tablet", factor_to_ssu: "1", level: 1, is_ssu: true, can_sell: true, can_purchase: true, is_default_sale: true },
  { id: "u2", name_ar: "علبة", name_en: "Pack", factor_to_ssu: "10", level: 2, is_ssu: false, can_sell: true, can_purchase: true, is_default_sale: false, is_default_purchase: true },
] };
const mget = vi.mocked(get);
const mpost = vi.mocked(post);

function ui() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><InventoryPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mget.mockReset(); mpost.mockReset();
  mget.mockImplementation(((path: string) => {
    if (path === "/inventory/locations") return Promise.resolve(LOCS);
    if (path === "/items") return Promise.resolve([P]);
    if (path === "/items/i1") return Promise.resolve(ITEM);
    return Promise.resolve([]);
  }) as unknown as typeof get);
  mpost.mockImplementation((() => Promise.resolve({ lotId: "lot-1" })) as unknown as typeof post);
});

describe("Inventory receive", () => {
  it("posts a receipt with the right payload", async () => {
    ui();
    fireEvent.change(await screen.findByLabelText(tr("inv.item")), { target: { value: "بارا" } });
    fireEvent.click(await screen.findByRole("option", { name: /باراسيتامول/ }));
    const unit = await screen.findByLabelText(tr("inv.unit"));
    expect((unit as HTMLSelectElement).value).toBe("u2");
    fireEvent.change(screen.getByLabelText(tr("inv.location")), { target: { value: "L1" } });
    fireEvent.change(screen.getByLabelText(tr("inv.qty")), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(tr("inv.lotNumber")), { target: { value: "L-01" } });
    fireEvent.change(screen.getByLabelText(tr("inv.expiryDate")), { target: { value: "2027-01-31" } });
    fireEvent.change(screen.getByLabelText(tr("inv.unitCost")), { target: { value: "1,500" } });
    fireEvent.click(screen.getByRole("button", { name: tr("inv.submitReceive") }));
    await waitFor(() => expect(mpost).toHaveBeenCalledWith("/inventory/receipts", expect.objectContaining({
      itemId: "i1", locationId: "L1", unitId: "u2", qtyInUnit: 10, lotNumber: "L-01", expiryDate: "2027-01-31", unitCostMinor: "150000", costCurrency: "YER_NEW",
    })));
  });

  it("blocks submit without an item and shows required errors", async () => {
    ui();
    fireEvent.click(await screen.findByRole("button", { name: tr("inv.submitReceive") }));
    const errs = await screen.findAllByText(tr("common.required"));
    expect(errs.length).toBeGreaterThan(0);
    expect(mpost).not.toHaveBeenCalled();
  });
});
