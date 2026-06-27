export const DEFAULT_WORKSPACE_TYPE = "research";

export const WORKSPACE_TYPES = [
  {
    id: "research",
    label: "Research Workspace",
    description: "Collect sources, questions, references, counterpoints, and evidence around a topic.",
    roles: [
      { id: "unassigned", label: "Unassigned" },
      { id: "source", label: "Source" },
      { id: "question", label: "Question" },
      { id: "reference", label: "Reference" },
      { id: "docs", label: "Docs" },
      { id: "counterpoint", label: "Counterpoint" },
      { id: "video", label: "Video" },
      { id: "to_verify", label: "To Verify" },
      { id: "revisit", label: "Revisit" },
      { id: "discard", label: "Discard" }
    ]
  },
  {
    id: "design",
    label: "Design Workspace",
    description: "Shape product, interface, visual, layout, and interaction ideas.",
    roles: [
      { id: "unassigned", label: "Unassigned" },
      { id: "inspiration", label: "Inspiration" },
      { id: "pattern", label: "Pattern" },
      { id: "ui_reference", label: "UI Reference" },
      { id: "brand_reference", label: "Brand Reference" },
      { id: "layout_idea", label: "Layout Idea" },
      { id: "interaction_idea", label: "Interaction Idea" },
      { id: "problem_example", label: "Problem Example" },
      { id: "asset", label: "Asset" },
      { id: "discard", label: "Discard" }
    ]
  },
  {
    id: "build",
    label: "Build Workspace",
    description: "Support implementation work with docs, examples, bugs, tooling, and dependencies.",
    roles: [
      { id: "unassigned", label: "Unassigned" },
      { id: "documentation", label: "Documentation" },
      { id: "api_reference", label: "API Reference" },
      { id: "example_code", label: "Example Code" },
      { id: "bug_reference", label: "Bug Reference" },
      { id: "error_search", label: "Error Search" },
      { id: "dependency", label: "Dependency" },
      { id: "tooling", label: "Tooling" },
      { id: "implementation_note", label: "Implementation Note" },
      { id: "discard", label: "Discard" }
    ]
  },
  {
    id: "decision",
    label: "Decision Workspace",
    description: "Compare options, evidence, risks, constraints, costs, and candidate decisions.",
    roles: [
      { id: "unassigned", label: "Unassigned" },
      { id: "option", label: "Option" },
      { id: "evidence_for", label: "Evidence For" },
      { id: "evidence_against", label: "Evidence Against" },
      { id: "risk", label: "Risk" },
      { id: "cost", label: "Cost" },
      { id: "requirement", label: "Requirement" },
      { id: "constraint", label: "Constraint" },
      { id: "decision_candidate", label: "Decision Candidate" },
      { id: "discard", label: "Discard" }
    ]
  },
  {
    id: "learning",
    label: "Learning Workspace",
    description: "Build skill or understanding through explanations, examples, exercises, videos, and practice.",
    roles: [
      { id: "unassigned", label: "Unassigned" },
      { id: "core_explanation", label: "Core Explanation" },
      { id: "example", label: "Example" },
      { id: "exercise", label: "Exercise" },
      { id: "reference", label: "Reference" },
      { id: "video_lesson", label: "Video Lesson" },
      { id: "glossary", label: "Glossary" },
      { id: "confusing_point", label: "Confusing Point" },
      { id: "practice_resource", label: "Practice Resource" },
      { id: "mastered", label: "Mastered" },
      { id: "discard", label: "Discard" }
    ]
  }
];

export function getWorkspaceType(workspaceTypeId) {
  return WORKSPACE_TYPES.find((type) => type.id === workspaceTypeId) || WORKSPACE_TYPES[0];
}

export function getWorkspaceRoles(workspaceTypeId) {
  return getWorkspaceType(workspaceTypeId).roles;
}

export function getWorkspaceTypeLabel(workspaceTypeId) {
  return getWorkspaceType(workspaceTypeId).label;
}

export function getWorkspaceTypeDescription(workspaceTypeId) {
  return getWorkspaceType(workspaceTypeId).description;
}

export function getWorkspaceRoleLabel(workspaceTypeId, roleId) {
  const role = getWorkspaceRoles(workspaceTypeId).find((item) => item.id === roleId);

  if (role) {
    return role.label;
  }

  if (roleId) {
    return "Legacy: " + roleId;
  }

  return "Unassigned";
}

export function isValidWorkspaceRole(workspaceTypeId, roleId) {
  return getWorkspaceRoles(workspaceTypeId).some((role) => role.id === roleId);
}
