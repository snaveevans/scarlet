# Project: <project-name>

## Meta
- **Tech Stack:** React Router v7, Cloudflare Workers, TypeScript, pnpm
- **Test Framework:** vitest
- **Lint Command:** pnpm lint
- **Build Command:** pnpm build
- **Typecheck Command:** pnpm typecheck
- **Project Root:** ./

## Context
<!-- Freeform architectural context, conventions, patterns.
     This section is injected into EVERY task execution as background context.
     Keep it concise — it eats into the context window. -->

Describe your project architecture, key patterns, conventions, and any
important constraints here. This is given to the agent on every task execution.

Examples:
- "This is a React SPA using React Router v7 in framework mode."
- "All API calls go through the `src/lib/api.ts` client."
- "Components use CSS modules. No inline styles."
- "Database access is always through the repository pattern in `src/repos/`."

## Tasks

### Task 1: <title>
- **ID:** T-001
- **Depends:** none
- **Files:** src/components/Example.tsx, src/components/Example.module.css
- **Description:** Describe what to implement in detail. Be specific about
  behavior, edge cases, and any constraints.
- **Acceptance Criteria:**
  - The component renders without errors
  - Props are validated with TypeScript types
  - Accessibility attributes are present
- **Tests:**
  - `src/components/__tests__/Example.test.tsx` — renders, props, a11y

### Task 2: <title>
- **ID:** T-002
- **Depends:** T-001
- **Files:** src/api/example.ts, src/types/example.ts
- **Description:** Describe what to implement.
- **Acceptance Criteria:**
  - API calls return typed responses
  - Errors are propagated correctly
- **Tests:**
  - `src/api/__tests__/example.test.ts` — success path, error path

### Task 3: <title>
- **ID:** T-003
- **Depends:** T-001, T-002
- **Files:** src/routes/example.tsx
- **Description:** Describe what to implement.
- **Acceptance Criteria:**
  - Page loads and renders data
  - Loading state shown while fetching
  - Error state shown on failure
- **Tests:**
  - `src/routes/__tests__/example.test.tsx` — renders, loading, error
