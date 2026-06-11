import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import { initNotifications } from "./lib/notify";
import "./index.css";

// Register the minimal notification service worker up front (best-effort) so the
// in-tab "get ready" cue can fire on Android Chrome. See src/lib/notify.ts.
initNotifications();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
);
