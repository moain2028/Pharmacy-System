import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";
import { useAuth } from "@/lib/auth";
export function renderFeature(ui: ReactElement) { useAuth.setState({ locale: "en" }); const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } }); return { client, ...render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>) }; }
