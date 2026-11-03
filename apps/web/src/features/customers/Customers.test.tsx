import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DICTS } from "@/i18n";
import { customersAr, customersEn } from "./customers.keys";
import Customers from "./index";

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

const rows = [
  { id: "c1", code: "C-001", name: "أحمد الصنعاني", phone: "777000111", credit_limit_minor: "5000000", credit_currency: "YER_NEW", is_walk_in: false, is_active: true, version: 1 },
  { id: "c2", code: "C-002", name: "صيدلية الشفاء", phone: null, credit_limit_minor: null, credit_currency: null, is_walk_in: false, is_active: false, version: 3 },
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={["/customers"]}><Routes><Route path="/customers/*" element={<Customers />} /></Routes></MemoryRouter></QueryClientProvider>,
  );
}

describe("Customers", () => {
  beforeEach(() => {
    Object.assign(DICTS.en, customersEn); Object.assign(DICTS.ar, customersAr);
    useAuth.setState({ locale: "en", me: { userId: "u1", username: "admin", displayName: "Admin", locale: "en", permissions: ["*"], tenantId: "t1" } });
    vi.mocked(get).mockReset(); vi.mocked(post).mockReset();
    vi.mocked(get).mockImplementation(((path: string) => Promise.resolve(path === "/customers" ? { rows, total: rows.length } : [])) as unknown as typeof get);
    vi.mocked(post).mockResolvedValue({ id: "c9" });
  });

  it("has identical ar/en key sets", () => {
    expect(Object.keys(customersAr).sort()).toEqual(Object.keys(customersEn).sort());
  });

  it("renders customers from the API", async () => {
    mount();
    expect(await screen.findByText("أحمد الصنعاني")).toBeTruthy();
    expect(screen.getByText("صيدلية الشفاء")).toBeTruthy();
    expect(screen.getByText("50,000.00 YER (new)")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/customers", expect.objectContaining({ q: "", limit: 25, offset: 0 }));
  });

  it("creates a customer with the expected payload", async () => {
    mount();
    await screen.findByText("أحمد الصنعاني");
    fireEvent.click(screen.getByRole("button", { name: String(customersEn["cust.new"]) }));
    fireEvent.change(screen.getByLabelText(customersEn["cust.name"] ?? ""), { target: { value: "Ahmed" } });
    fireEvent.change(screen.getByLabelText(customersEn["cust.phone"] ?? ""), { target: { value: "777123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/customers", { name: "Ahmed", phone: "777123456" }));
  });

  it("rejects an empty name", async () => {
    mount();
    await screen.findByText("أحمد الصنعاني");
    fireEvent.click(screen.getByRole("button", { name: String(customersEn["cust.new"]) }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(customersEn["cust.nameRequired"] ?? "");
    expect(post).not.toHaveBeenCalled();
  });
});
