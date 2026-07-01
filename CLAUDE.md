# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup          # First-time setup: install deps, generate Prisma client, run migrations
npm run dev            # Start dev server with Turbopack at http://localhost:3000
npm run dev:daemon     # Start dev server in background, logs to logs.txt
npm run build          # Production build
npm run lint           # ESLint
npm test               # Run all tests (Vitest + jsdom)
npx vitest run src/components/chat/__tests__/ChatInterface.test.tsx  # Run a single test file
npx prisma migrate dev # Run pending DB migrations
npm run db:reset       # Reset DB (destructive)
```

**Do not run `npm audit fix`.** Dependencies are pinned to specific compatible versions. Known CVEs are addressed by bumping pinned versions directly.

## Environment

Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without a real key the app falls back to `MockLanguageModel` in `src/lib/provider.ts`, which returns canned components. The placeholder key in the repo also triggers the mock path.

## Architecture

This is a Next.js 15 App Router app. The core loop: user chats → AI generates React component code via tool calls → components render live in an iframe.

### Request flow

1. `src/app/api/chat/route.ts` — POST handler. Deserializes the virtual FS from the request body, calls `streamText` (Vercel AI SDK) with two tools, streams the response. Saves messages + FS state to the DB on finish (authenticated users only).
2. **AI tools** (`src/lib/tools/`): `str_replace_editor` (create/str_replace/insert on virtual files) and `file_manager` (rename/delete). The AI writes code by calling these tools.
3. `src/lib/contexts/chat-context.tsx` — wraps `useChat` from `@ai-sdk/react`. Intercepts `onToolCall` and dispatches to `handleToolCall` in the FS context.
4. `src/lib/contexts/file-system-context.tsx` — React context holding the `VirtualFileSystem` instance. `handleToolCall` applies tool mutations to the in-memory FS and triggers a re-render via `refreshTrigger`.
5. `src/components/preview/PreviewFrame.tsx` — on every `refreshTrigger` change, calls `createImportMap` + `createPreviewHTML` and writes the result to an iframe's `srcdoc`.

### Virtual file system

`src/lib/file-system.ts` — `VirtualFileSystem` is an in-memory tree (no disk I/O). Files are keyed by path in a `Map<string, FileNode>`. It serializes to/from plain `Record<string, FileNode>` for persistence in the DB (`Project.data` column, stored as JSON string) and transmission in API request bodies.

### Preview pipeline

`src/lib/transform/jsx-transformer.ts`:
- `transformJSX` — Babel standalone transforms JSX/TSX → JS, strips CSS imports.
- `createImportMap` — walks all files, transforms each, creates blob URLs, builds an ES module import map. Third-party packages resolve to `esm.sh`. Missing local imports get placeholder stub modules.
- `createPreviewHTML` — produces a full HTML document with the import map, React loaded from `esm.sh/react@19`, Tailwind CDN, and an `ErrorBoundary` wrapping the app entry point (`/App.jsx` or `/App.tsx` by default).

### Auth

`src/lib/auth.ts` — JWT via `jose`, stored in an httpOnly cookie (`auth-token`). `src/middleware.ts` protects `/api/projects` and `/api/filesystem`. The `/api/chat` route is **not** protected but only persists to DB when `projectId` is present and the session is valid.

### Data model

`prisma/schema.prisma` (SQLite):
- `User` — email + bcrypt password hash
- `Project` — belongs to optional `User`. `messages` (JSON array string) + `data` (JSON object string for VFS snapshot)

Anonymous users get session-storage tracking via `src/lib/anon-work-tracker.ts`. When they sign up, their in-progress work can be migrated to a project.

### UI layout

`src/app/main-content.tsx` — three-panel layout (resizable panels):
- Left: `ChatInterface` (35% default)
- Right: tabs switching between `PreviewFrame` (live iframe) and Code view (`FileTree` + `CodeEditor` with Monaco)

`src/components/ui/` — shadcn/ui components (Radix primitives + Tailwind).

### Model

The AI model is `claude-haiku-4-5` (`src/lib/provider.ts`). The system prompt is in `src/lib/prompts/generation.tsx`.
