# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup        # Install deps, generate Prisma client, run migrations (first-time setup)
npm run dev          # Start dev server with Turbopack
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (all tests)
npm run db:reset     # Force reset database migrations
```

Run a single test file:
```bash
npx vitest run src/path/to/file.test.ts
```

Environment: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without it, the app runs with a mock provider (static responses, `maxSteps: 4`).

## Architecture

**UIGen** is a Next.js 15 (App Router) AI-powered React component generator. Users describe components in chat; Claude generates/edits code using tool calls; a live preview renders the result.

### Core Data Flow

1. **User sends a message** → `POST /api/chat` (`src/app/api/chat/route.ts`)
2. **Chat API** reconstructs a `VirtualFileSystem` from serialized file nodes sent by the client, then calls `streamText` (Vercel AI SDK + Anthropic) with two tools: `str_replace_editor` and `file_manager`
3. **AI tool calls** mutate the in-memory `VirtualFileSystem` — no disk writes
4. **Streamed response** is consumed by the client; file changes are reflected in the preview
5. **On finish**, if the user is authenticated and a `projectId` is present, messages + serialized file data are persisted to SQLite via Prisma

### Key Modules

| Path | Role |
|------|------|
| `src/lib/file-system.ts` | `VirtualFileSystem` class — in-memory tree, serializes to/from plain objects for DB storage and API transport |
| `src/lib/tools/` | `str_replace_editor` and `file_manager` tools passed to the AI; they wrap `VirtualFileSystem` mutations |
| `src/lib/prompts/generation.ts` | System prompt for the AI (instructs Claude how to write components) |
| `src/lib/provider.ts` | Returns the language model — real Anthropic model or mock when no API key |
| `src/lib/auth.ts` | JWT/JWE session handling via `jose`; no third-party auth library |
| `src/actions/` | Next.js Server Actions for CRUD on `Project` records |
| `src/app/[projectId]/` | Dynamic route — loads a saved project and initializes state |
| `src/components/preview/` | Renders generated React components live using Babel Standalone for in-browser evaluation |

### Database Schema

SQLite via Prisma. Two models: `User` (email + hashed password) and `Project` (belongs to User; stores `messages` and `files` as JSON strings). Projects cascade-delete with their user.

### Auth

Cookie-based JWE sessions (no NextAuth). `src/middleware.ts` protects routes. The `use-auth` hook reads session state client-side.

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).
