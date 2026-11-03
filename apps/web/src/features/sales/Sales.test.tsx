import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { get } from "@/lib/api";
import SalesPage from "./index";

vi.mock("@/lib/api", () => ({
  get: vi.fn(), post: vi.fn(),
  ApiError: class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } },
}));

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/"]}>{ui}</MemoryRouter></QueryClientProvider>);
};

describe("Sales list", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("renders invoices from the API", async () => {
    (get as unknown as Mock).mockImplementation((path: string) => {
      if (path === "/sales") return Promise.resolve({ total: 1, rows: [{ id: "s1", number: "INV-0001", business_date: "2024-05-01", customer_name: "أحمد", total_minor: "150000", paid_minor: "150000", credit_minor: "0", currency: "YER_NEW", status: "POSTED" }] });
      return Promise.resolve({ rows: [] });
    });
    wrap(<SalesPage />);
    expect(await screen.findByText("INV-0001")).toBeTruthy();
    expect(screen.getByText("أحمد")).toBeTruthy();
    expect(screen.getAllByText(/1,500\.00/).length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith("/sales", expect.objectContaining({ limit: 50, offset: 0 }));
  });
});
