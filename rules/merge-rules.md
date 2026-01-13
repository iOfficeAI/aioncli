# Merge Rules for aioncli (Gemini CLI Upstream)

本文档总结合并过程中的原则与操作规则，供后续合并时遵循。

## 目标

- 以不破坏 aioncli 魔改能力为前提，最大化吸收上游 gemini-cli 的新增功能与修复。
- 对冲突文件逐项评审，不默认覆盖本地魔改。
- 保持可持续合并能力：尽量局部改动、避免无谓重构。

## 必须保留的魔改能力（核心）

- 多模型兼容（OpenAI/DeepSeek/Qwen/OpenRouter 等）与 OpenAI 相关支持。
- 新增 `AuthType.USE_OPENAI` 及 OpenAI ContentGenerator 的接入逻辑。
- API key 轮换逻辑：`packages/core/src/fallback/handler.ts` 中
  `[PATCH:API_KEY_ROTATION_START]` 至 `[PATCH:API_KEY_ROTATION_END]`
  逻辑与注释必须原封不动保留。

## aioncli 魔改文件完整清单（需保留/重点审查）

以下清单基于 `aioncli-analysis.md`
与本次合并过程整理，所有文件都应纳入“魔改保护区”，合并冲突时逐一审查：

- OpenAI 适配核心
  - `packages/core/src/core/openaiContentGenerator.ts`
  - `packages/core/src/core/openaiContentGenerator.test.ts`
  - `packages/core/src/core/contentGenerator.ts`
  - `packages/core/src/core/baseLlmClient.ts`
  - `packages/core/src/utils/safeJsonParse.ts`
  - `packages/core/src/core/tokenLimits.ts`
  - `packages/core/src/utils/retry.ts`
- 回退/轮 key 与降级逻辑
  - `packages/core/src/fallback/handler.ts`
  - `packages/core/src/fallback/handler.test.ts`
- skills/提示注入（技能功能）
  - `packages/core/src/core/prompts.ts`
  - `packages/core/src/core/prompts.test.ts`
  - `packages/core/src/skills/skillManager.ts`
  - `packages/core/src/skills/skillManager.test.ts`
  - `packages/core/src/skills/skillLoader.ts`
  - `packages/core/src/skills/skillLoader.test.ts`
  - `packages/core/src/tools/activate-skill.ts`
  - `packages/core/src/tools/activate-skill.test.ts`
- 消息与工具关键路径
  - `packages/core/src/core/turn.ts`
  - `packages/core/src/utils/fileUtils.ts`
  - `packages/core/src/tools/write-file.ts`

## 冲突处理原则

1. **魔改优先**
   - 涉及 OpenAI 支持、AuthType、内容生成、fallback 轮 key 的冲突，优先保留本地逻辑。

2. **上游增强优先**
   - 与魔改无关的结构性改进、兼容性修复、工具链更新优先采用上游版本。

3. **同一文件双向合并**
   - 上游修改与本地魔改同时存在时，不直接覆盖。
   - 先合并上游，再回填本地魔改，确保两侧逻辑可用。

4. **注释不可删**
   - 本地的 PATCH 标记与关键注释必须保留。
   - 若重写文件，先提取注释块，再完整回填。

## 合并流程（推荐）

1. 建新分支（避免污染主分支）。
2. `git merge <upstream-tag> --no-commit`，先自动合并无冲突文件。
3. 列出冲突文件并逐个处理：
   - 先审魔改核心
   - 再审 skills 相关
   - 最后审其它
4. 处理完一个文件后：
   - 确认无冲突标记
   - `git add <file>`
5. 最终 `git status` 确认无冲突，再提交。

## 具体处理经验（本次合并）

- `packages/core/src/core/baseLlmClient.ts`
  - 需保留 OpenAI generateJson 分支；上游 fallback / retry 逻辑需并存。

- `packages/core/src/core/geminiChat.ts`
  - 保留 aioncli 对 Gemini-3 thinkingConfig 的处理；恢复上游 hooks。

- `packages/core/src/core/prompts.ts`
  - 保留 skills 的提示注入逻辑（技能列表 JSON / XML 两种格式择一）。
  - 不删除 skills 激活说明。

- `packages/core/src/fallback/handler.ts`
  - 必须保留 `[PATCH:API_KEY_ROTATION_*]` 注释与逻辑。
  - 轮 key 逻辑优先，其后才走上游 policy fallback。
  - 可增加双语注释，但不得破坏原注释块。

- `packages/core/src/utils/stdio.test.ts`
  - 采用 `createWorkingStdio`（上游新接口）并清理冲突标记。

## 提交注意事项

- 用户本地文档不提交：
  - `docs/aioncli-analysis.md`
  - `docs/desktop-app-architecture.md`
- 如 pre-commit 超时，可用 `--no-verify`，但需记录说明。

## 复核清单

- OpenAI 相关文件未删除。
- `[PATCH:API_KEY_ROTATION_*]` 原样保留。
- skills 功能仍可触达（tools、prompt、manager）。
- `git status` 无冲突标记（无 `UU/AA/DD`）。
- 本地 docs 不提交。
