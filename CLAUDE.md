# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is **aioncli**, a fork of Google's Gemini CLI that adds multi-model
support. The core enhancement is an OpenAI-compatible API adapter layer that
enables the CLI to work with OpenAI, DeepSeek, Qwen, OpenRouter, and any
OpenAI-compatible API endpoint, while maintaining full compatibility with
upstream Gemini CLI.

**Key differentiation**: The original Gemini CLI only supports Google's Gemini
models. This fork adds a ~2000-line `OpenAIContentGenerator` adapter that
translates between Gemini and OpenAI API formats, enabling users to choose their
preferred model provider.

## Repository Structure

This is a **monorepo** using npm workspaces:

```
packages/
├── core/              # Core logic: ContentGenerator abstraction, tools, agents
├── cli/               # Interactive CLI interface (React/Ink-based)
├── a2a-server/        # Agent-to-Agent server for headless operation
├── test-utils/        # Shared testing utilities
└── vscode-ide-companion/  # VSCode extension integration
```

**Critical**: Changes to `packages/core` affect all other packages. Always run
`npm run build` at the root after core changes.

## Build & Development Commands

### Building

```bash
# Build all packages (required after any changes)
npm run build

# Build specific package
npm run build --workspace @office-ai/aioncli-core
npm run build --workspace @google/gemini-cli

# Build and start CLI
npm run build-and-start
```

### Running

```bash
# Start CLI in development mode
npm run start

# Start A2A server (for headless/IDE integration)
npm run start:a2a-server

# Debug with Node inspector
npm run debug
```

### Testing

```bash
# Run all tests across packages
npm run test

# Run tests in specific package
npm run test --workspace @office-ai/aioncli-core
npm run test --workspace @google/gemini-cli

# Run specific test file (from package directory)
cd packages/core
npx vitest run src/core/openaiContentGenerator.test.ts

# Run tests in watch mode
npx vitest watch

# Run integration tests
npm run test:integration:sandbox:none
npm run test:e2e
```

### Linting & Formatting

```bash
# Lint all code
npm run lint

# Auto-fix lint and formatting issues
npm run lint:fix

# Format only
npm run format

# Type checking
npm run typecheck
```

## Core Architecture

### ContentGenerator Abstraction (Multi-Model Support)

The key architectural pattern enabling multi-model support:

```typescript
// packages/core/src/core/contentGenerator.ts
export interface ContentGenerator {
  generateContent(request, userPromptId): Promise<GenerateContentResponse>;
  generateContentStream(request, userPromptId): Promise<AsyncGenerator<...>>;
  countTokens(request): Promise<CountTokensResponse>;
  embedContent(request): Promise<EmbedContentResponse>;
}
```

**Implementations**:

- **GeminiContentGenerator** (original): Uses `@google/genai` SDK for Gemini
  models
- **OpenAIContentGenerator** (added): Translates Gemini ↔ OpenAI formats for
  compatible APIs
- **LoggingContentGenerator**: Wraps any generator with telemetry
- **RecordingContentGenerator**: Records conversations for testing
- **FakeContentGenerator**: Mock for tests

**Location of OpenAI adapter**:
`packages/core/src/core/openaiContentGenerator.ts`

This file contains:

- Request format conversion (Gemini → OpenAI)
- Response format conversion (OpenAI → Gemini)
- Tool/function call translation
- Streaming response handling
- Vendor-specific workarounds (DeepSeek, OpenRouter, DashScope)

### Authentication Flow

```typescript
// packages/core/src/core/contentGenerator.ts
export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  USE_OPENAI = 'openai', // Added for multi-model support
  // ...
}
```

The `createContentGenerator()` factory selects the appropriate implementation
based on `AuthType` and environment variables.

### Tool System

Tools are registered in `packages/core/src/tools/tool-registry.ts`:

- File operations: `ReadFileTool`, `WriteFileTool`, `EditTool`, `GlobTool`
- Search: `GrepTool`, `RipGrepTool`
- Shell: `ShellTool`
- Web: `WebFetchTool`, `WebSearchTool`
- Memory: `MemoryTool` (GEMINI.md context files)
- MCP: Model Context Protocol server integration

Tools implement `AnyDeclarativeTool` and return `ToolInvocation` instances that
handle parameter validation, confirmation prompts, and execution.

### Agent System (Delegated Tasks)

Agents are specialized sub-processes for complex tasks:

- **Bash**: Command execution specialist
- **Explore**: Fast codebase exploration
- **Plan**: Implementation planning
- **General-purpose**: Multi-step autonomous tasks

Agents are registered in `packages/core/src/agents/registry.ts` and invoked via
`DelegateToAgentTool`.

## Multi-Model Configuration

Configure via environment variables:

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"

# DeepSeek
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://api.deepseek.com/v1"

# Qwen (DashScope)
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"

# OpenRouter (aggregator)
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
```

When `OPENAI_API_KEY` is set, the CLI automatically uses `AuthType.USE_OPENAI`
and routes through `OpenAIContentGenerator`.

## Upstream Merge Strategy

This fork maintains merge-ability with upstream Gemini CLI. Follow these rules
when merging upstream changes:

### Protected Files (Preserve Local Changes)

These files contain the multi-model magic and must be carefully reviewed during
merges:

**OpenAI Adapter**:

- `packages/core/src/core/openaiContentGenerator.ts` (the heart of multi-model
  support)
- `packages/core/src/core/openaiContentGenerator.test.ts`
- `packages/core/src/core/contentGenerator.ts` (added `AuthType.USE_OPENAI`)
- `packages/core/src/core/baseLlmClient.ts` (OpenAI JSON generation support)

**Fallback/Retry Logic**:

- `packages/core/src/fallback/handler.ts` (API key rotation logic marked with
  `[PATCH:API_KEY_ROTATION_*]` comments)
- `packages/core/src/utils/retry.ts`

**Skills System** (if modified):

- `packages/core/src/skills/*`
- `packages/core/src/tools/activate-skill.ts`

### Merge Process

1. Create feature branch: `git checkout -b merge-upstream-vX.Y.Z`
2. Merge without committing: `git merge <upstream-tag> --no-commit`
3. Review conflicts in protected files first
4. For protected files: preserve local OpenAI-related logic, accept upstream
   improvements elsewhere
5. Test thoroughly: `npm run build && npm run test`
6. Commit with descriptive message referencing upstream version

### Special Markers

Look for these comment markers when resolving conflicts:

- `[PATCH:API_KEY_ROTATION_START]` / `[PATCH:API_KEY_ROTATION_END]`: API key
  rotation logic
- `// Copyright 2025 QWEN`: Code borrowed from qwen-code (preserve attribution)

## Common Workflows

### Adding Support for a New Model Provider

If the provider is OpenAI-compatible, no code changes needed—just configure
`OPENAI_BASE_URL`.

If custom logic is needed (like DeepSeek Reasoner's `reasoning_content` field):

1. Add detection logic in `OpenAIContentGenerator`:

   ```typescript
   private isNewProviderModel(): boolean {
     return this.model.includes('provider-identifier');
   }
   ```

2. Add custom handling in request/response conversion methods:
   - `convertToOpenAIFormat()` for request modifications
   - `convertToGeminiFormat()` for response modifications

3. Add vendor-specific headers if needed (see OpenRouter/DashScope examples)

4. Add tests in `packages/core/src/core/openaiContentGenerator.test.ts`

### Running the CLI with Different Models

```bash
# With Gemini (original behavior)
export GEMINI_API_KEY="..."
npm run start

# With OpenAI
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://api.openai.com/v1"
npm run start

# With DeepSeek
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
npm run start
```

### Debugging API Format Issues

1. Enable debug logging:

   ```bash
   export DEBUG=1
   npm run debug
   ```

2. Check conversion in `OpenAIContentGenerator`:
   - `convertToOpenAIFormat()`: Gemini request → OpenAI format
   - `convertToGeminiFormat()`: OpenAI response → Gemini format
   - Look for tool call translation issues

3. Common issues:
   - **Type mismatches**: OpenAI requires `type: "string"`, not
     `type: ["string", "null"]`
   - **Tool call IDs**: Must be unique and properly matched between
     call/response
   - **Streaming**: Tool calls accumulate across chunks and only emit on
     `finish_reason`

### Adding a New Core Tool

1. Create tool file: `packages/core/src/tools/my-tool.ts`
2. Implement `AnyDeclarativeTool` interface
3. Register in `packages/core/src/config/config.ts` → `createToolRegistry()`
4. Add tests: `packages/core/src/tools/my-tool.test.ts`
5. Rebuild: `npm run build`

## Key Files Reference

| Purpose                    | Location                                           |
| -------------------------- | -------------------------------------------------- |
| OpenAI adapter             | `packages/core/src/core/openaiContentGenerator.ts` |
| ContentGenerator interface | `packages/core/src/core/contentGenerator.ts`       |
| Tool registry              | `packages/core/src/tools/tool-registry.ts`         |
| Agent registry             | `packages/core/src/agents/registry.ts`             |
| Model configuration        | `packages/core/src/config/models.ts`               |
| Main CLI entry             | `packages/cli/src/index.ts`                        |
| A2A server                 | `packages/a2a-server/src/index.ts`                 |
| Merge rules                | `rules/merge-rules.md`                             |
| Architecture analysis      | `rules/aioncli-analysis.md`                        |

## Testing Philosophy

- **Unit tests**: Vitest for TypeScript/Node.js logic
- **Integration tests**: `integration-tests/` directory with real file
  operations
- **Mock API responses**: `msw` library for intercepting HTTP calls
- **UI tests**: `ink-testing-library` for React components

When adding OpenAI-related features, always add corresponding tests in
`openaiContentGenerator.test.ts` covering:

- Request format conversion
- Response format conversion
- Tool call handling
- Error cases
- Vendor-specific logic
