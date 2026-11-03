import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class ApiError extends Error {} }));

import { get } from "@/lib/api";
import { BOM, toCsv } from "./csv";
import { ReportTable } from "./ReportTable";
import { reportsAr, reportsEn } from "./reports.keys";
import ReportsPage from "./index";

const mockGet = vi.mocked(get);

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

const SALES = {
  currency: "YER_NEW",
  rows: [{ key: "2024-01", labelAr: "يناير", labelEn: "January", count: 3, gross: "150000", discount: "0", net: "150000", tax: "0", total: "150000", cogs: "90000", grossMargin: "60000", returnRefund: "0" }],
  totals: { count: 3, total: "150000" },
};

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(((path: string) => Promise.resolve(path === "/reports/sales" ? SALES : { rows: [] })) as typeof get);
});

describe("toCsv", () => {
  it("adds a UTF-8 BOM, escapes commas and quotes, exports money as decimals", () => {
    const csv = toCsv(
      [{ name: "Panadol, 500mg", note: 'he said "hi"', amt: "150000" }],
      [{ key: "name", title: "Name" }, { key: "note", title: "Note" }, { key: "amt", title: "Amount", money: true, currency: "YER_NEW" }],
      { name: "Total", amt: "150000" },
    );
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(BOM.length).split("\r\n");
    expect(lines[0]).toBe("Name,Note,Amount");
    expect(lines[1]).toBe('"Panadol, 500mg","he said ""hi""",1500.00');
    expect(lines[2]).toBe("Total,,1500.00");
  });
  it("neutralises formula injection", () => {
    const csv = toCsv([{ a: "=SUM(A1)" }], [{ key: "a", title: "A" }]);
    expect(csv.split("\r\n")[1]).toBe("'=SUM(A1)");
  });
});

describe("ReportTable", () => {
  it("renders a totals row with formatted money", () => {
    wrap(<ReportTable columns={[{ key: "name", title: "Item" }, { key: "amt", title: "Amount", money: true, currency: "YER_NEW" }]} rows={[{ name: "A", amt: "100000" }, { name: "B", amt: "150000" }]} totals={{ amt: "250000" }} />);
    expect(screen.getByTestId("totals-row").textContent).toContain("2,500.00");
  });
});

describe("reports keys", () => {
  it("have identical ar/en key sets", () => {
    expect(Object.keys(reportsAr).sort()).toEqual(Object.keys(reportsEn).sort());
  });
});

describe("ReportsPage", () => {
  it("loads the sales report and refetches when groupBy changes", async () => {
    wrap(<ReportsPage />);
    expect(await screen.findByText("يناير")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith("/reports/sales", expect.objectContaining({ groupBy: "day" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "month" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/reports/sales", expect.objectContaining({ groupBy: "month" })));
  });
});
