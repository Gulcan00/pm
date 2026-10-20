# Frontend Guide

## Current App

- This is a Next.js App Router application using React, TypeScript, and Tailwind CSS 4.
- `next.config.ts` enables static export; `npm run build` writes the deployable site to `out/`. Docker builds this export and FastAPI serves it at `/`.
- `src/app/page.tsx` renders the Kanban board. `src/app/layout.tsx` loads the global stylesheet, fonts, and page metadata.
- `src/components/AuthGate.tsx` checks the FastAPI session and renders the login form or board. Authentication requests are same-origin; the signed session cookie is HttpOnly and managed by FastAPI.
- `src/components/KanbanBoard.tsx` owns the current board view state and loads/mutates it through the authenticated FastAPI API.
- `KanbanColumn.tsx`, `KanbanCard.tsx`, `NewCardForm.tsx`, and `KanbanCardPreview.tsx` compose the board UI. Drag-and-drop uses `@dnd-kit`; card and column edits persist through the board API.
- `src/lib/kanban.ts` defines board and AI operation types, sample board data, card ID generation, and the `moveCard` operation.
- `AIChatSidebar.tsx` keeps chat history in component state for the active page session. AI-proposed operations are reviewed and only applied after explicit user approval; history is discarded on reload or logout.

## Conventions

- Keep components and board types in their existing folders; prefer the `@/` alias for imports from `src/`.
- Follow the existing TypeScript and React component style and preserve the established visual language and color variables in `src/app/globals.css`.
- Keep board behavior in the existing board/component or `lib` layers; avoid duplicating board mutation logic in UI components.
- Add or update focused Vitest tests next to the affected source. Use Playwright for browser-level workflows in `tests/`.
- Do not add a dependency or expand the app beyond the approved project plan without need.

## Commands

- `npm run dev`: run the Next.js development server.
- `npm run lint`: lint the frontend.
- `npm run test:unit`: run Vitest unit tests.
- `npm run test:e2e`: run Playwright browser tests.
- `npm run test:all`: run unit and end-to-end tests.
- `npm run build`: build the frontend.

Playwright starts the Docker Compose app on `127.0.0.1:8000` as configured in `playwright.config.ts`; Docker and the Playwright Chromium browser are required. Vitest uses jsdom and loads `src/test/setup.ts` as configured in `vitest.config.ts`.