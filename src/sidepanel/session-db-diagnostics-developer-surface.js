import { registerDeveloperSurface } from "./developer-mode.js";

installSessionDbDiagnosticsDeveloperSurface();

function installSessionDbDiagnosticsDeveloperSurface() {
  const section = document.getElementById("sessionDbDiagnosticsSection");
  if (!section) return;

  registerDeveloperSurface(section);
}
