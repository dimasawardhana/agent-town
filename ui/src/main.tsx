import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// React owns the DOM, including the div Phaser renders into. The game is
// created by the TownCanvas effect, after that div exists.
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
