import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { get, post } from "@/lib/api";
import ReturnsPage from "./index";

vi.mock("@/lib/api", () => ({
  get: vi.fn(), post: vi.fn(),
  ApiError: class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } },
}));

const ID = "11111111-1111-4111-8111-111111111111";
const detail = {
  invoice: { id: ID, number: "INV-0007", business_date: "2024-05-02", customer_name: null, total_minor: "150000", paid_minor: "150000", credit_minor: "0", currency: "YER_NEW", status: "POSTED" },
  lines: [{ id: "L1", item_id: "i1", trade_name_ar: "بنادول", trade_name_en: "Panadol", unit_name_ar: "شريط", unit_name_en: "Strip", factor_to_ssu: "1", qty_in_unit: 10, qty_ssu: "10", unit_price_minor: "15000", total_minor: "150000" }],
  lots: [], payments: [{ method: "CASH", currency: "YER_NEW", amount_minor: "150000" }],
};

describe("Returns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (get as unknown as Mock).mockImplementation((path: string) => path === `/sales/${ID}` ? Promise.resolve(detail) : Promise.resolve({ rows: [] }));
    (post as unknown as Mock).mockResolvedValue({ refundTotal: { currency: "YER_NEW", amountMinor: "30000" }, refunds: [{ method: "CASH", amount: { currency: "YER_NEW", amountMinor: "30000" } }], lots: [{ lotId: "lot-1", qtySsu: "2", destination: "AVAILABLE" }], lines: [] });
  });
  it("quotes when qty changes and shows the refund total", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/returns?invoiceId=${ID}`]}><ReturnsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("INV-0007")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
    await waitFor(() => expect(post).toHaveBeenCalledWith("/returns/quote", expect.objectContaining({ invoiceId: ID, lines: [{ lineId: "L1", qtySsu: "2" }], reason: { code: "CUSTOMER_CHANGED_MIND" } })));
    expect((await screen.findAllByText(/300\.00/)).length).toBeGreaterThan(0);
    expect(post).not.toHaveBeenCalledWith("/returns", expect.anything());
  });
  it("flags quantities above the returnable amount and does not quote", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/returns?invoiceId=${ID}`]}><ReturnsPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByText("INV-0007");
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "11" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 350));
    expect(post).not.toHaveBeenCalled();
  });
});
