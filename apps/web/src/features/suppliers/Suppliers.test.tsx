import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { get, post } from "@/lib/api";
import { renderFeature } from "@/features/procurement/test-utils";
import Suppliers from "@/features/suppliers/index";
import SupplierForm from "@/features/suppliers/SupplierForm";
vi.mock("@/lib/api", async importOriginal => { const original = await importOriginal<typeof import("@/lib/api")>(); return { ...original, get: vi.fn(), post: vi.fn(), patch: vi.fn() }; });
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(get).mockResolvedValue({ rows: [{ id: "s1", code: "S1", name: "Al Shifa", phone: "123", default_currency: "YER_NEW", payment_terms_days: 0, is_active: true, version: 1 }], total: 1 }); vi.mocked(post).mockResolvedValue({ id: "new" }); });
describe("suppliers", () => {
  it("renders supplied rows", async () => { renderFeature(<Suppliers />); expect(await screen.findByText("Al Shifa")).toBeTruthy(); expect(get).toHaveBeenCalledWith("/suppliers", { q: "", limit: 50, offset: 0 }); });
  it("posts the supplier schema", async () => { const done = vi.fn(); renderFeature(<SupplierForm onDone={done} />); fireEvent.change(screen.getByLabelText("Supplier name"), { target: { value: "  Al Shifa  " } }); fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "777123456" } }); fireEvent.change(screen.getByLabelText("Payment terms (days)"), { target: { value: "30" } }); fireEvent.click(screen.getByRole("button", { name: "Save" })); await waitFor(() => expect(post).toHaveBeenCalledWith("/suppliers", { name: "Al Shifa", phone: "777123456", address: "", taxNumber: "", defaultCurrency: "YER_NEW", paymentTermsDays: 30, earlyPaymentDays: 0, earlyPaymentBp: 0 })); await waitFor(() => expect(done).toHaveBeenCalledOnce()); });
  it("rejects a blank name and invalid terms", () => { renderFeature(<SupplierForm onDone={() => undefined} />); fireEvent.change(screen.getByLabelText("Payment terms (days)"), { target: { value: "-1" } }); fireEvent.click(screen.getByRole("button", { name: "Save" })); expect(screen.getByRole("alert")).toBeTruthy(); expect(post).not.toHaveBeenCalled(); });
});
