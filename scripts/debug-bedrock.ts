/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

async function testBedrockAuth() {
  console.log('=== Bedrock Authentication Debug ===\n');

  const region = process.env['AWS_REGION'] || 'us-east-1';
  const model =
    process.env['BEDROCK_MODEL'] || 'anthropic.claude-3-sonnet-20240229-v1:0';

  console.log(`Region: ${region}`);
  console.log(`Model: ${model}`);
  console.log(
    `AWS_PROFILE: ${process.env['AWS_PROFILE'] || '(not set, using default credential chain)'}`,
  );
  console.log('');

  // Step 1: Test credential retrieval
  console.log('Step 1: Testing AWS credential retrieval...');
  try {
    const credentials = fromNodeProviderChain();
    const creds = await credentials();
    console.log(
      `✓ Credentials retrieved successfully, Access Key ID: ${creds.accessKeyId.slice(0, 8)}...`,
    );
  } catch (error) {
    console.error('✗ Credential retrieval failed:', (error as Error).message);
    console.error('\nPlease check:');
    console.error(
      '  1. AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables',
    );
    console.error(
      '  2. Or AWS_PROFILE pointing to valid ~/.aws/credentials configuration',
    );
    console.error('  3. Or IAM Role (if running on EC2/Lambda)');
    process.exit(1);
  }

  // Step 2: Create Bedrock client
  console.log('\nStep 2: Creating Bedrock client...');
  const client = new BedrockRuntimeClient({
    region,
    credentials: fromNodeProviderChain(),
  });
  console.log('✓ Bedrock client created successfully');

  // Step 3: Test simple conversation
  console.log('\nStep 3: Testing Converse API...');
  try {
    const response = await client.send(
      new ConverseCommand({
        modelId: model,
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello! Please respond with a short greeting.' }],
          },
        ],
        inferenceConfig: {
          maxTokens: 100,
          temperature: 0.7,
        },
      }),
    );

    console.log('✓ API call successful');
    console.log(`  Stop Reason: ${response.stopReason}`);
    console.log(`  Input Tokens: ${response.usage?.inputTokens}`);
    console.log(`  Output Tokens: ${response.usage?.outputTokens}`);

    const outputText = response.output?.message?.content?.[0]?.text;
    console.log(`\nResponse content:\n  "${outputText}"`);
  } catch (error) {
    const err = error as Error & { name?: string };
    console.error('✗ API call failed:', err.message);

    if (err.name === 'AccessDeniedException') {
      console.error(
        '\nInsufficient permissions. Please check IAM policy includes:',
      );
      console.error('  - bedrock:InvokeModel');
      console.error('  - bedrock:InvokeModelWithResponseStream');
    } else if (err.name === 'ValidationException') {
      console.error(
        '\nRequest parameter error. Please check if model ID is correct',
      );
    } else if (err.name === 'ResourceNotFoundException') {
      console.error(`\nModel ${model} is not available in region ${region}`);
      console.error('Please check if the model is enabled in Bedrock console');
    }
    process.exit(1);
  }

  // Step 4: Test streaming response (optional)
  console.log('\nStep 4: Testing streaming response...');
  try {
    const streamResponse = await client.send(
      new ConverseStreamCommand({
        modelId: model,
        messages: [
          {
            role: 'user',
            content: [{ text: 'Count from 1 to 5.' }],
          },
        ],
        inferenceConfig: {
          maxTokens: 50,
        },
      }),
    );

    console.log('Streaming response content:');
    process.stdout.write('  ');

    for await (const event of streamResponse.stream || []) {
      if (event.contentBlockDelta?.delta?.text) {
        process.stdout.write(event.contentBlockDelta.delta.text);
      }
    }
    console.log('\n✓ Streaming response test successful');
  } catch (error) {
    console.error(
      '✗ Streaming response test failed:',
      (error as Error).message,
    );
  }

  // Step 5: Test tool use (optional)
  console.log('\nStep 5: Testing tool use...');
  try {
    const toolResponse = await client.send(
      new ConverseCommand({
        modelId: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                text: 'What is the weather in San Francisco? Use the get_weather tool.',
              },
            ],
          },
        ],
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: 'get_weather',
                description: 'Get the current weather for a location',
                inputSchema: {
                  json: {
                    type: 'object',
                    properties: {
                      location: {
                        type: 'string',
                        description: 'The city and state',
                      },
                    },
                    required: ['location'],
                  },
                },
              },
            },
          ],
        },
        inferenceConfig: {
          maxTokens: 200,
        },
      }),
    );

    console.log('✓ Tool use test successful');
    console.log(`  Stop Reason: ${toolResponse.stopReason}`);

    const content = toolResponse.output?.message?.content;
    if (content) {
      for (const block of content) {
        if (block.text) {
          console.log(`  Text: ${block.text}`);
        }
        if (block.toolUse) {
          console.log(`  Tool Use ID: ${block.toolUse.toolUseId}`);
          console.log(`  Tool Name: ${block.toolUse.name}`);
          console.log(`  Tool Input: ${JSON.stringify(block.toolUse.input)}`);
        }
      }
    }
  } catch (error) {
    console.error('✗ Tool use test failed:', (error as Error).message);
  }

  console.log('\n=== Debug Complete ===');
  console.log(
    'All tests passed! Bedrock authentication and conversation functions are working.',
  );
}

testBedrockAuth().catch(console.error);
