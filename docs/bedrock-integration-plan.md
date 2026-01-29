# AWS Bedrock Integration Implementation Plan

## Overview

Add AWS Bedrock support to aioncli using the unified Converse API, with priority
support for Anthropic Claude model series and multi-region deployment.

## Requirements Confirmation

- **Region Support**: Multi-region (globally available)
- **Priority Models**: Anthropic Claude (3.5/3.7 Sonnet)
- **Implementation Scope**: Complete implementation (text generation, tool
  calling, streaming responses, token counting, embedding)

## Supported Model List

**Phase 1: Anthropic Claude model series only**

### Cross-Region Models (Cross-Region Inference Profiles, Recommended)

These models use the `global.` prefix and can be called from any AWS region,
providing optimal availability and fault tolerance.

- `global.anthropic.claude-opus-4-5-20251101-v1:0` - Claude Opus 4.5 (most
  powerful)
- `global.anthropic.claude-sonnet-4-5-20250929-v1:0` - Claude Sonnet 4.5
  (recommended, default)
- `global.anthropic.claude-sonnet-4-20250514-v1:0` - Claude Sonnet 4
- `global.anthropic.claude-haiku-4-5-20251001-v1:0` - Claude Haiku 4.5 (fastest)

### Regional Models

These models are only available in specific regions and provide backward
compatibility with older Claude versions.

- `anthropic.claude-3-5-sonnet-20241022-v2:0` - Claude 3.5 Sonnet v2
- `anthropic.claude-3-5-sonnet-20240620-v1:0` - Claude 3.5 Sonnet v1
- `anthropic.claude-3-opus-20240229-v1:0` - Claude 3 Opus
- `anthropic.claude-3-haiku-20240307-v1:0` - Claude 3 Haiku

**Future Phases**: Extend support to Amazon Titan, Meta Llama, and Mistral
models as needed.

## Core Architecture Design

### 1. ContentGenerator Implementation

Create `BedrockContentGenerator` class implementing the `ContentGenerator`
interface:

```typescript
// packages/core/src/core/bedrockContentGenerator.ts
export class BedrockContentGenerator implements ContentGenerator {
  private client: BedrockRuntimeClient;
  private model: string;
  private region: string;

  async generateContent(
    request,
    userPromptId,
  ): Promise<GenerateContentResponse>;
  async generateContentStream(
    request,
    userPromptId,
  ): AsyncGenerator<GenerateContentResponse>;
  async countTokens(request): Promise<CountTokensResponse>;
  async embedContent(request): Promise<EmbedContentResponse>;
}
```

### 2. API Format Conversion

#### Gemini → Bedrock Converse Request Format

**Message Conversion**:

- Gemini:
  `{role: 'user'|'model', parts: [{text}|{functionCall}|{functionResponse}]}`
- Bedrock:
  `{role: 'user'|'assistant', content: [{text}|{toolUse}|{toolResult}]}`

**Tool Definition Conversion**:

- Gemini: `functionDeclarations` with `parameters` (JSON Schema)
- Bedrock: `toolSpec` with `inputSchema.json` (JSON Schema)

**System Instruction**:

- Gemini: `systemInstruction` field
- Bedrock: `system` array `[{text: '...'}]`

#### Bedrock Converse → Gemini Response Format

**Text Content**:

- Bedrock: `{content: [{text: '...'}]}`
- Gemini: `{parts: [{text: '...'}]}`

**Tool Calls**:

- Bedrock: `{content: [{toolUse: {toolUseId, name, input}}]}`
- Gemini: `{parts: [{functionCall: {id, name, args}}]}`

**Finish Reason Mapping**:

- `end_turn` → `STOP`
- `max_tokens` → `MAX_TOKENS`
- `stop_sequence` → `STOP`
- `tool_use` → `STOP`
- `content_filtered` → `SAFETY`

### 3. Streaming Response Handling

Use `ConverseStreamCommand` to process event streams:

```typescript
async *streamGenerator(stream) {
  const toolCalls = new Map(); // Accumulate tool calls

  for await (const event of stream) {
    if (event.contentBlockStart) {
      // Start new content block
    }
    if (event.contentBlockDelta) {
      // Accumulate text/tool input
      if (event.contentBlockDelta.delta?.text) {
        yield convertTextDelta(event);
      }
      if (event.contentBlockDelta.delta?.toolUse) {
        accumulateToolCall(event);
      }
    }
    if (event.contentBlockStop) {
      // Complete tool call, emit full result
      yield finalizeToolCall(event);
    }
    if (event.metadata) {
      // Token usage information
      yield convertUsageMetadata(event);
    }
  }
}
```

### 4. Tool Call Handling

**Multi-turn Conversation Support**:

1. User message → Model returns toolUse
2. Convert to Gemini functionCall → CLI executes tool
3. Tool result converts to toolResult → Send back to Bedrock
4. Bedrock returns final response

**ID Matching**:

- Bedrock `toolUseId` ↔ Gemini `functionCall.id`
- Ensure tool call and response IDs are consistent

## Key File Modifications

### New Files

1. **`/packages/core/src/core/bedrockContentGenerator.ts`** (~1800 lines)
   - BedrockContentGenerator class implementation
   - Format conversion methods
   - Streaming response handling
   - Error handling and retry logic

2. **`/packages/core/src/core/bedrockContentGenerator.test.ts`** (~600 lines)
   - Mock AWS SDK client
   - Format conversion tests
   - Tool calling tests
   - Streaming response tests

### Modified Files

3. **`/packages/core/src/core/contentGenerator.ts`**
   - Add `AuthType.USE_BEDROCK = 'bedrock'`
   - Update `ContentGeneratorConfig` type to add `awsRegion?: string`
   - Add Bedrock routing in `createContentGenerator()` factory function

4. **`/packages/core/src/config/config.ts`**
   - Add AWS environment variable detection in `createContentGeneratorConfig()`
   - Read `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

5. **`/packages/core/src/config/models.ts`**
   - Add Bedrock model constants and validation
   - Define
     `DEFAULT_BEDROCK_MODEL = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0'`

6. **`/packages/core/package.json`**
   - Add dependencies:
     - `"@aws-sdk/client-bedrock-runtime": "^3.700.0"`
     - `"@aws-sdk/credential-providers": "^3.700.0"` (for AWS Profile
       authentication)

## Implementation Details

### AWS Authentication

**Simplest Approach: Fully rely on AWS SDK default credential chain**

```typescript
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// SDK automatically finds credentials, in priority order:
// 1. Environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
// 2. AWS_PROFILE specified profile (from ~/.aws/credentials)
// 3. Default [default] profile (from ~/.aws/credentials)
const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
```

**User Configuration Examples**:

**Method 1: Environment Variables (suitable for temporary use or CI/CD)**

```bash
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."
npm run start
```

**Method 2: AWS Profile (recommended, supports multi-account switching)**

```bash
# ~/.aws/credentials file content:
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[enterprise-ai]
aws_access_key_id = AKIA...
aws_secret_access_key = ...

# Use default profile
export AWS_REGION="us-east-1"
npm run start

# Use enterprise-ai profile
export AWS_REGION="ap-southeast-1"
export AWS_PROFILE="enterprise-ai"
npm run start
```

**Advantages**:

- Minimal code (~5 lines)
- AWS SDK automatically handles all authentication logic
- Supports all AWS standard authentication methods (env vars, profiles, IAM
  roles, etc.)
- Users don't need to learn new configuration methods

### Token Counting Implementation

**Background**:

- Bedrock responses include precise `usage.inputTokens/outputTokens/totalTokens`
- `countTokens` method is mainly used for media content estimation and error
  logging
- Doesn't need to be particularly precise, simple estimation is sufficient

**Implementation**:

```typescript
async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
  // Extract all text content
  const text = request.contents
    .flatMap(c => c.parts)
    .filter(p => 'text' in p)
    .map(p => p.text)
    .join('');

  // Simple estimation: 1 token ≈ 4 characters (suitable for English and code)
  // Actual tokens for Claude models will differ slightly, but sufficient for estimation
  const totalTokens = Math.ceil(text.length / 4);

  return { totalTokens };
}
```

**Note**: This method is for estimation only; actual token usage is based on the
usage in API responses.

### Embedding Support

**Phase 1: Not Implemented**:

- Claude models don't provide embedding capability
- `embedContent` method is not actually used in the CLI
- Simply return "not supported" error

```typescript
async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
  throw new Error(
    'Embedding is not supported for Claude models on Bedrock. ' +
    'Consider using Amazon Titan Embed models in future versions.'
  );
}
```

**Future Extension**: If embedding support is needed, Amazon Titan Embed models
can be added (using InvokeModel API).

### Error Handling

**Throttling Retry** (ThrottlingException):

```typescript
private async sendWithRetry(command, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.client.send(command);
    } catch (error) {
      if (error.name === 'ThrottlingException' && attempt < maxRetries - 1) {
        await sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
        continue;
      }
      if (error.name === 'ValidationException') {
        throw new Error(`Bedrock validation error: ${error.message}`);
      }
      throw error;
    }
  }
}
```

### JSON Mode Support

Bedrock doesn't support native JSON mode; use tool calling to simulate:

```typescript
if (request.config?.responseJsonSchema) {
  const jsonTool = {
    toolSpec: {
      name: 'respond_in_schema',
      description: 'Response in JSON schema',
      inputSchema: { json: request.config.responseJsonSchema },
    },
  };

  // Force use of this tool
  const command = new ConverseCommand({
    modelId: this.model,
    messages,
    toolConfig: {
      tools: [jsonTool],
      toolChoice: { tool: { name: 'respond_in_schema' } },
    },
  });
}
```

## Configuration Examples

### Environment Variable Configuration

```bash
# Use AWS access keys
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."

# Or use AWS Profile
export AWS_REGION="ap-southeast-1"
export AWS_PROFILE="my-profile"

# Start CLI
npm run start
```

### Model Selection

```bash
# Use default cross-region Claude Sonnet 4.5 model
npm run start

# Specify specific cross-region model
npm run start -- --model global.anthropic.claude-opus-4-5-20251101-v1:0

# Use regional model
npm run start -- --model anthropic.claude-3-5-sonnet-20241022-v2:0

# Use Titan
npm run start -- --model amazon.titan-text-premier-v1:0
```

### View Available Models

```bash
# List all Anthropic models in current region
aws bedrock list-foundation-models \
  --region $AWS_REGION \
  --by-provider Anthropic
```

## Testing Strategy

### Unit Tests (vitest)

Mock AWS SDK client:

```typescript
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(),
  ConverseCommand: vi.fn(),
  ConverseStreamCommand: vi.fn(),
}));

const mockClient = {
  send: vi.fn(),
};

BedrockRuntimeClient.mockImplementation(() => mockClient);
```

Test Coverage:

- ✅ Request format conversion (Gemini → Bedrock)
- ✅ Response format conversion (Bedrock → Gemini)
- ✅ Tool definition conversion
- ✅ Tool call/response conversion
- ✅ Streaming response accumulation
- ✅ Finish reason mapping
- ✅ Error handling (throttling, validation errors)
- ✅ Token counting estimation
- ✅ Embedding calls

### Integration Tests

Requires real AWS credentials:

```bash
# Set test credentials
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

# Run integration tests
npm run test:integration:bedrock
```

Test Scenarios:

- Single-turn conversations
- Multi-turn conversations
- Tool calling (read files, execute commands)
- Streaming responses
- Different model families (Claude, Titan, Llama)

## Validation Plan

### End-to-End Testing

1. **Basic Conversation**:

   ```bash
   npm run start
   > Hello, please introduce yourself
   # Verify: Normal response returned
   ```

2. **Tool Calling**:

   ```bash
   > Read the README.md file in the current directory
   # Verify: Calls ReadFileTool, returns file content
   ```

3. **Multi-turn Conversation**:

   ```bash
   > Create a file named test.txt with content "Hello Bedrock"
   # Verify: Calls WriteFileTool, confirms creation success
   > Now read this file
   # Verify: Calls ReadFileTool, returns correct content
   ```

4. **Streaming Response**:

   ```bash
   > Write a poem about cloud computing
   # Verify: Character-by-character display, smooth experience
   ```

5. **Cross-Region Testing**:

   ```bash
   # Test Asia-Pacific region
   export AWS_REGION="ap-southeast-1"
   npm run start

   # Test European region
   export AWS_REGION="eu-west-1"
   npm run start
   ```

### Performance Validation

- Response latency < 2 seconds (non-streaming)
- Streaming first byte latency < 500ms
- Token counting error < 10%
- Throttling retry success rate > 95%

## Potential Challenges and Solutions

### 1. Stricter Bedrock Throttling

**Issue**: Claude models on Bedrock have stricter rate limits (e.g., 10 req/min)

**Solutions**:

- Implement exponential backoff retry
- Provide friendly error messages suggesting users request quota increases
- Support multi-region failover (if multiple regions configured)

### 2. Significant Tool Call Format Differences

**Issue**: Bedrock's toolUse/toolResult format differs significantly from Gemini

**Solutions**:

- Reference OpenAIContentGenerator's tool conversion logic
- Establish complete ID mapping mechanism
- Add detailed logging for debugging

### 3. Different Schema Requirements for Different Models

**Issue**: Claude and Llama have different levels of JSON Schema support

**Solutions**:

- Implement schema sanitization function to remove unsupported fields
- Perform compatibility testing for each model family
- Document limitations of each model in documentation

### 4. Embedding Only Supports Titan

**Issue**: Claude and Llama models don't provide embeddings

**Solutions**:

- Detect model type in `embedContent()`
- Return clear error message if not a Titan embedding model
- Suggest users switch to `amazon.titan-embed-text-v2:0`

## Implementation Priority

### Phase 1 (Core Functionality)

- ✅ BedrockContentGenerator basic structure
- ✅ Text generation (generateContent)
- ✅ Streaming responses (generateContentStream)
- ✅ Basic error handling
- ✅ Claude model support

### Phase 2 (Tool Support)

- ✅ Tool definition conversion
- ✅ Tool calling and response handling
- ✅ Multi-turn conversation support
- ✅ Complete unit tests

### Phase 3 (Enhanced Features)

- ✅ Token counting implementation (simple estimation)
- ✅ Throttling retry optimization
- ✅ Single region configuration (via AWS_REGION environment variable)

### Phase 4 (Production Ready)

- ⏳ Integration tests (basic tests complete, can be extended)
- ✅ Documentation improvements (authentication docs added)
- ✅ Performance optimization (retry logic integrated)
- ✅ Error message localization (enhanceError provides friendly error messages)

## Estimated Effort

**Phase 1 (Claude support only)**:

- Core implementation: ~1500 lines of code (BedrockContentGenerator)
- Test code: ~500 lines of code (unit tests + format conversion tests)
- Configuration changes: ~100 lines of code (AuthType, factory, models config)
- Documentation updates: ~300 lines of documentation

Total: Approximately 2400 lines of code

**Simplifications**:

- ❌ No support for Titan/Llama/Mistral models
- ❌ No Embedding functionality
- ✅ Token counting uses simple estimation
- ✅ Only implement environment variable and AWS Profile authentication
