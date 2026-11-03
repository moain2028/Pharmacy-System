import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { get } from "@/lib/api";
import ItemsPage from "./index";
import ItemForm, { blankUnit, validateLadder } from "./ItemForm";
import type { ItemBody, ItemRow } from "./types";

vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn(), ApiError: class ApiError extends Error {} }));

const ITEMS: ItemRow[] = [
  { id: "11111111-1111-4111-8111-111111111111", code: "P-001", trade_name_ar: "باراسيتامول 500", trade_name_en: "Paracetamol 500", generic_name: "Paracetamol", strength: "500mg", dosage_form: "Tablet", rx_required: "NONE", tax_bp: 0, is_active: true },
  { id: "22222222-2222-4222-8222-222222222222", code: "A-002", trade_name_ar: "أموكسيسيلين 500", trade_name_en: "Amoxicillin 500", generic_name: "Amoxicillin", strength: "500mg", dosage_form: "Capsule", rx_required: "RX", tax_bp: 500, is_active: false },
];

const wrap = (ui: ReactNode, path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
};

beforeEach(() => {
  vi.mocked(get).mockReset();
  vi.mocked(get).mockImplementation(((path: string) => Promise.resolve(path === "/items" ? ITEMS : [])) as unknown as typeof get);
});

describe("items list", () => {
  it("renders rows from the API with limit/offset", async () => {
    wrap(<Routes><Route path="/items/*" element={<ItemsPage />} /></Routes>, "/items");
    expect(await screen.findByText("باراسيتامول 500")).toBeTruthy();
    expect(screen.getByText("أموكسيسيلين 500")).toBeTruthy();
    expect(vi.mocked(get)).toHaveBeenCalledWith("/items", expect.objectContaining({ limit: 50, offset: 0 }));
  });
});

describe("ItemForm units ladder", () => {
  it("validateLadder rejects a ladder without an SSU and accepts a valid one", () => {
    const box = { ...blankUnit(1, false), nameAr: "علبة", nameEn: "Box", factor: "10" };
    expect(validateLadder([box]).form).toContain("items.err.oneSsu");
    const tablet = { ...blankUnit(2, true), nameAr: "حبة", nameEn: "Tablet" };
    expect(validateLadder([box, tablet]).form).toEqual([]);
    const bad = validateLadder([{ ...box, factor: "15" }, { ...blankUnit(2, false), nameAr: "شريط", nameEn: "Strip", factor: "10" }, { ...tablet, level: "3" }]);
    expect(bad.rows[0]?.factor).toBe("items.err.divisible");
  });

  const fill = () => {
    fireEvent.change(screen.getByTestId("f-tradeNameAr"), { target: { value: "بنادول" } });
    fireEvent.change(screen.getByTestId("f-tradeNameEn"), { target: { value: "Panadol" } });
    fireEvent.change(screen.getByTestId("u-nameAr-0"), { target: { value: "حبة" } });
    fireEvent.change(screen.getByTestId("u-nameEn-0"), { target: { value: "Tablet" } });
  };

  it("blocks submit and shows an inline error when no unit is the SSU", () => {
    const onSubmit = vi.fn();
    wrap(<ItemForm onSubmit={onSubmit} onCancel={() => undefined} submitting={false} />, "/");
    fill();
    fireEvent.click(screen.getByTestId("u-isSsu-0"));
    fireEvent.submit(screen.getByTestId("item-form"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("submits a schema-shaped payload for a valid item", () => {
    const onSubmit = vi.fn();
    wrap(<ItemForm onSubmit={onSubmit} onCancel={() => undefined} submitting={false} />, "/");
    fill();
    fireEvent.submit(screen.getByTestId("item-form"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = onSubmit.mock.calls[0]?.[0] as ItemBody | undefined;
    expect(body?.tradeNameAr).toBe("بنادول");
    expect(body?.taxBp).toBe(0);
    expect(body?.rxRequired).toBe("NONE");
    expect(body?.units[0]).toMatchObject({ nameAr: "حبة", nameEn: "Tablet", factorToSsu: 1, level: 1, isSsu: true });
  });
});
