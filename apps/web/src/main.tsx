import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./i18n/register-features";
import { AppRouter } from "./app/router";
import { useAuth } from "./lib/auth";
import { bindPrefs } from "./lib/prefs";
import { dirOf } from "./i18n";
import "./styles.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } } });

// <html lang dir> follows the locale (portals, print, assistive tech); theme/density/digits come from device prefs.
function applyDir() { const l = useAuth.getState().locale; document.documentElement.lang = l; document.documentElement.dir = dirOf(l); }
applyDir(); useAuth.subscribe(applyDir);
bindPrefs();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
ReactDOM.createRoot(root).render(
  <React.StrictMode><QueryClientProvider client={qc}><AppRouter /></QueryClientProvider></React.StrictMode>,
);
