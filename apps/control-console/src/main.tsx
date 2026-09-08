import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./i18n";
import "./styles.css";
import { loadRuntimeConfig, type RuntimeConfig } from "./lib/runtime-config";

function Root() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadRuntimeConfig()
      .then(setConfig)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  if (error) {
    return (
      <main className="login-page">
        <h1>Control Console</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (!config) {
    return (
      <main className="login-page">
        <p>Loading…</p>
      </main>
    );
  }
  return (
    <BrowserRouter>
      <App runtime={config} />
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
