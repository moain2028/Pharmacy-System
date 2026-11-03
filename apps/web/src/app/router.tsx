import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
import Shell from "./Shell";

const L = (f: () => Promise<{ default: React.ComponentType }>) => { const C = lazy(f); return <Suspense fallback={<Spinner />}><C /></Suspense>; };

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}
function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const can = useAuth((s) => s.can);
  return can(perm) ? <>{children}</> : <Navigate to="/" replace />;
}

/** Feature pages are provided by feature modules; missing ones render a placeholder until implemented. */
const page = (name: string) => L(() => import(`../features/${name}/index.tsx`).catch(() => import("../features/_placeholder")));

export const router = createBrowserRouter([
  { path: "/login", element: L(() => import("../features/auth/LoginPage")) },
  { path: "/setup", element: L(() => import("../features/setup/SetupWizard")) },
  {
    path: "/", element: <RequireAuth><Shell /></RequireAuth>,
    children: [
      { index: true, element: page("dashboard") },
      { path: "pos", element: <RequirePerm perm="sales.create">{page("pos")}</RequirePerm> },
      { path: "sales/*", element: <RequirePerm perm="sales.read">{page("sales")}</RequirePerm> },
      { path: "returns/*", element: <RequirePerm perm="returns.create">{page("returns")}</RequirePerm> },
      { path: "customers/*", element: <RequirePerm perm="customers.read">{page("customers")}</RequirePerm> },
      { path: "items/*", element: <RequirePerm perm="items.read">{page("items")}</RequirePerm> },
      { path: "inventory/*", element: <RequirePerm perm="stock.read">{page("inventory")}</RequirePerm> },
      { path: "expiry", element: <RequirePerm perm="expiry.read">{page("expiry")}</RequirePerm> },
      { path: "purchasing/*", element: <RequirePerm perm="purchase_orders.read">{page("purchasing")}</RequirePerm> },
      { path: "suppliers/*", element: <RequirePerm perm="suppliers.read">{page("suppliers")}</RequirePerm> },
      { path: "payables/*", element: <RequirePerm perm="supplier_invoices.read">{page("payables")}</RequirePerm> },
      { path: "cash/*", element: <RequirePerm perm="shifts.read">{page("cash")}</RequirePerm> },
      { path: "expenses/*", element: <RequirePerm perm="cash.expense">{page("expenses")}</RequirePerm> },
      { path: "reports/*", element: <RequirePerm perm="reports.sales">{page("reports")}</RequirePerm> },
      { path: "accounting/*", element: <RequirePerm perm="journal.read">{page("accounting")}</RequirePerm> },
      { path: "users/*", element: <RequirePerm perm="users.read">{page("users")}</RequirePerm> },
      { path: "settings/*", element: <RequirePerm perm="settings.read">{page("settings")}</RequirePerm> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function AppRouter() { return <RouterProvider router={router} />; }
export { Outlet };
