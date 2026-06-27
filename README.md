# Chrome Flow

Chrome Flow is a local-first browser cognitive workspace.

V0.1 goal:

- Load current Chrome tabs
- Create a workspace
- Add custom tab aliases
- Add a workspace aim/directive
- Add journal entries
- Track a simple timeline
- Store everything locally in Chrome extension storage

Development install:

1. Open Chrome.
2. Go to chrome://extensions.
3. Enable Developer Mode.
4. Click Load unpacked.
5. Select C:\Users\nolan\AIProjects\chrome-flow.
6. Click the Chrome Flow extension icon.
7. The side panel should open.

Build principle:

Chrome Flow Core owns workspace state.

AI providers may generate suggestions later, but the core product must work without AI.
