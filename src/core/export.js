export function workspaceToMarkdown(workspace) {
  const lines = [];

  lines.push("# " + (workspace.name || "Chrome Flow Workspace"));
  lines.push("");
  lines.push("## Aim");
  lines.push(workspace.aim || "No aim recorded.");
  lines.push("");
  lines.push("## Tabs");

  for (const tab of workspace.tabs || []) {
    lines.push("- " + (tab.alias || tab.originalTitle || "Untitled tab"));
    lines.push("  - URL: " + (tab.url || ""));
    lines.push("  - Role: " + (tab.role || "unassigned"));
  }

  lines.push("");
  lines.push("## Journal");

  for (const entry of workspace.journal || []) {
    lines.push("- " + entry.createdAt + ": " + entry.text);
  }

  lines.push("");
  lines.push("## Timeline");

  for (const event of workspace.timeline || []) {
    lines.push("- " + event.createdAt + ": " + event.type + " - " + event.message);
  }

  return lines.join("\n");
}
