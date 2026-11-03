import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import UsersPage from "./index";
import { usersEn } from "./users.keys";

vi.mock("@/lib/api", () => ({
  get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const ROLE_ID = "11111111-1111-4111-8111-111111111111";
const data: Record<string, unknown> = {
  "/users": [{ id: "u1", username: "ali", display_name: "Ali", locale: "ar", is_active: true, roles: [{ id: ROLE_ID, code: "CASHIER" }] }],
  "/roles": [{ id: ROLE_ID, code: "CASHIER", name_ar: "كاشير", name_en: "Cashier", permissions: [], limits: {} }],
  "/auth/permissions": [],
};

const k = (key: string): string => usersEn[key] ?? key;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><UsersPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  useAuth.setState({ locale: "en" });
  vi.mocked(get).mockReset().mockImplementation(((path: string) => Promise.resolve(data[path] ?? [])) as typeof get);
  vi.mocked(post).mockReset().mockResolvedValue({ id: "new" });
});

async function openCreate() {
  renderPage();
  await screen.findByText("ali");
  fireEvent.click(screen.getByRole("button", { name: k("users.new") }));
  fireEvent.change(screen.getByLabelText(k("users.username")), { target: { value: "sara" } });
  fireEvent.change(screen.getByLabelText(k("users.displayName")), { target: { value: "Sara" } });
  fireEvent.change(screen.getByLabelText(k("users.password")), { target: { value: "secret123" } });
}

describe("UsersPage", () => {
  it("renders users with role badges", async () => {
    renderPage();
    expect(await screen.findByText("ali")).toBeTruthy();
    expect(screen.getByText("CASHIER")).toBeTruthy();
  });

  it("creating a user posts roleIds", async () => {
    await openCreate();
    fireEvent.click(await screen.findByLabelText("Cashier"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/users", expect.objectContaining({ username: "sara", displayName: "Sara", password: "secret123", roleIds: [ROLE_ID] })));
  });

  it("blocks submit without a role", async () => {
    await openCreate();
    await screen.findByLabelText("Cashier");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain(k("users.err.roles"));
    expect(post).not.toHaveBeenCalled();
  });
});
