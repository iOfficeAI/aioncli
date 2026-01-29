# Gemini CLI authentication setup

To use Gemini CLI, you'll need to authenticate with Google. This guide helps you
quickly find the best way to sign in based on your account type and how you're
using the CLI.

For most users, we recommend starting Gemini CLI and logging in with your
personal Google account.

## Choose your authentication method <a id="auth-methods"></a>

Select the authentication method that matches your situation in the table below:

| User Type / Scenario                                                   | Recommended Authentication Method                                | Google Cloud Project Required                               |
| :--------------------------------------------------------------------- | :--------------------------------------------------------------- | :---------------------------------------------------------- |
| Individual Google accounts                                             | [Login with Google](#login-google)                               | No, with exceptions                                         |
| Organization users with a company, school, or Google Workspace account | [Login with Google](#login-google)                               | [Yes](#set-gcp)                                             |
| AI Studio user with a Gemini API key                                   | [Use Gemini API Key](#gemini-api)                                | No                                                          |
| Google Cloud Vertex AI user                                            | [Vertex AI](#vertex-ai)                                          | [Yes](#set-gcp)                                             |
| AWS Bedrock user with Anthropic Claude models                          | [AWS Bedrock](#aws-bedrock)                                      | No (AWS account required)                                   |
| [Headless mode](#headless)                                             | [Use Gemini API Key](#gemini-api) or<br> [Vertex AI](#vertex-ai) | No (for Gemini API Key)<br> [Yes](#set-gcp) (for Vertex AI) |

### What is my Google account type?

- **Individual Google accounts:** Includes all
  [free tier accounts](../quota-and-pricing/#free-usage) such as Gemini Code
  Assist for individuals, as well as paid subscriptions for
  [Google AI Pro and Ultra](https://gemini.google/subscriptions/).

- **Organization accounts:** Accounts using paid licenses through an
  organization such as a company, school, or
  [Google Workspace](https://workspace.google.com/). Includes
  [Google AI Ultra for Business](https://support.google.com/a/answer/16345165)
  subscriptions.

## (Recommended) Login with Google <a id="login-google"></a>

If you run Gemini CLI on your local machine, the simplest authentication method
is logging in with your Google account. This method requires a web browser on a
machine that can communicate with the terminal running Gemini CLI (e.g., your
local machine).

> **Important:** If you are a **Google AI Pro** or **Google AI Ultra**
> subscriber, use the Google account associated with your subscription.

To authenticate and use Gemini CLI:

1. Start the CLI:

   ```bash
   gemini
   ```

2. Select **Login with Google**. Gemini CLI opens a login prompt using your web
   browser. Follow the on-screen instructions. Your credentials will be cached
   locally for future sessions.

### Do I need to set my Google Cloud project?

Most individual Google accounts (free and paid) don't require a Google Cloud
project for authentication. However, you'll need to set a Google Cloud project
when you meet at least one of the following conditions:

- You are using a company, school, or Google Workspace account.
- You are using a Gemini Code Assist license from the Google Developer Program.
- You are using a license from a Gemini Code Assist subscription.

For instructions, see [Set your Google Cloud Project](#set-gcp).

## Use Gemini API key <a id="gemini-api"></a>

If you don't want to authenticate using your Google account, you can use an API
key from Google AI Studio.

To authenticate and use Gemini CLI with a Gemini API key:

1. Obtain your API key from
   [Google AI Studio](https://aistudio.google.com/app/apikey).

2. Set the `GEMINI_API_KEY` environment variable to your key. For example:

   ```bash
   # Replace YOUR_GEMINI_API_KEY with the key from AI Studio
   export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   ```

   To make this setting persistent, see
   [Persisting Environment Variables](#persisting-vars).

3. Start the CLI:

   ```bash
   gemini
   ```

4. Select **Use Gemini API key**.

> **Warning:** Treat API keys, especially for services like Gemini, as sensitive
> credentials. Protect them to prevent unauthorized access and potential misuse
> of the service under your account.

## Use Vertex AI <a id="vertex-ai"></a>

To use Gemini CLI with Google Cloud's Vertex AI platform, choose from the
following authentication options:

- A. Application Default Credentials (ADC) using `gcloud`.
- B. Service account JSON key.
- C. Google Cloud API key.

Regardless of your authentication method for Vertex AI, you'll need to set
`GOOGLE_CLOUD_PROJECT` to your Google Cloud project ID with the Vertex AI API
enabled, and `GOOGLE_CLOUD_LOCATION` to the location of your Vertex AI resources
or the location where you want to run your jobs.

For example:

```bash
# Replace with your project ID and desired location (e.g., us-central1)
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
export GOOGLE_CLOUD_LOCATION="YOUR_PROJECT_LOCATION"
```

To make any Vertex AI environment variable settings persistent, see
[Persisting Environment Variables](#persisting-vars).

#### A. Vertex AI - application default credentials (ADC) using `gcloud`

Consider this authentication method if you have Google Cloud CLI installed.

> **Note:** If you have previously set `GOOGLE_API_KEY` or `GEMINI_API_KEY`, you
> must unset them to use ADC:
>
> ```bash
> unset GOOGLE_API_KEY GEMINI_API_KEY
> ```

1. Verify you have a Google Cloud project and Vertex AI API is enabled.

2. Log in to Google Cloud:

   ```bash
   gcloud auth application-default login
   ```

3. [Configure your Google Cloud Project](#set-gcp).

4. Start the CLI:

   ```bash
   gemini
   ```

5. Select **Vertex AI**.

#### B. Vertex AI - service account JSON key

Consider this method of authentication in non-interactive environments, CI/CD
pipelines, or if your organization restricts user-based ADC or API key creation.

> **Note:** If you have previously set `GOOGLE_API_KEY` or `GEMINI_API_KEY`, you
> must unset them:
>
> ```bash
> unset GOOGLE_API_KEY GEMINI_API_KEY
> ```

1.  [Create a service account and key](https://cloud.google.com/iam/docs/keys-create-delete)
    and download the provided JSON file. Assign the "Vertex AI User" role to the
    service account.

2.  Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the JSON
    file's absolute path. For example:

    ```bash
    # Replace /path/to/your/keyfile.json with the actual path
    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/keyfile.json"
    ```

3.  [Configure your Google Cloud Project](#set-gcp).

4.  Start the CLI:

    ```bash
    gemini
    ```

5.  Select **Vertex AI**.
    > **Warning:** Protect your service account key file as it gives access to
    > your resources.

#### C. Vertex AI - Google Cloud API key

1.  Obtain a Google Cloud API key:
    [Get an API Key](https://cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys?usertype=newuser).

2.  Set the `GOOGLE_API_KEY` environment variable:

    ```bash
    # Replace YOUR_GOOGLE_API_KEY with your Vertex AI API key
    export GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"
    ```

    > **Note:** If you see errors like
    > `"API keys are not supported by this API..."`, your organization might
    > restrict API key usage for this service. Try the other Vertex AI
    > authentication methods instead.

3.  [Configure your Google Cloud Project](#set-gcp).

4.  Start the CLI:

    ```bash
    gemini
    ```

5.  Select **Vertex AI**.

## Use AWS Bedrock <a id="aws-bedrock"></a>

To use Gemini CLI with AWS Bedrock and Anthropic Claude models, choose from the
following authentication options:

- A. AWS Profile (recommended for local development)
- B. AWS Environment Variables
- C. IAM Role (for EC2/ECS/Lambda environments)

### Prerequisites

Before using AWS Bedrock authentication:

1. **AWS Account**: You need an AWS account with access to Amazon Bedrock.

2. **Model Access**: Request access to Anthropic Claude models in the AWS
   Bedrock console:
   - Navigate to [AWS Bedrock Console](https://console.aws.amazon.com/bedrock)
   - Go to "Model access" in the left sidebar
   - Request access to Claude models (Claude 3.5, Claude 4, etc.)

3. **IAM Permissions**: Ensure your AWS credentials have the following
   permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:InvokeModelWithResponseStream"
         ],
         "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
       }
     ]
   }
   ```

### A. AWS Bedrock - AWS Profile (Recommended)

This is the recommended method for local development and supports multiple AWS
accounts.

1. Configure your AWS credentials using AWS CLI:

   ```bash
   # Configure a new AWS profile
   aws configure --profile enterprise-ai
   # Enter your AWS Access Key ID, Secret Access Key, and default region
   ```

   Or manually edit `~/.aws/credentials`:

   ```ini
   [enterprise-ai]
   aws_access_key_id = YOUR_ACCESS_KEY
   aws_secret_access_key = YOUR_SECRET_KEY
   ```

   And `~/.aws/config`:

   ```ini
   [profile enterprise-ai]
   region = ap-southeast-1
   output = json
   ```

2. Set the AWS profile and region environment variables:

   ```bash
   export AWS_PROFILE="enterprise-ai"
   export AWS_REGION="ap-southeast-1"
   ```

   To make this setting persistent, see
   [Persisting Environment Variables](#persisting-vars).

3. Start the CLI:

   ```bash
   gemini
   ```

   Gemini CLI will automatically detect AWS Bedrock credentials and use them.

### B. AWS Bedrock - Environment Variables

Use this method for CI/CD pipelines or temporary credentials.

1. Set AWS credentials as environment variables:

   ```bash
   export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY"
   export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_KEY"
   export AWS_REGION="us-east-1"
   ```

   For temporary credentials (STS), also include:

   ```bash
   export AWS_SESSION_TOKEN="YOUR_SESSION_TOKEN"
   ```

2. Start the CLI:

   ```bash
   gemini
   ```

   > **Warning:** Treat AWS credentials as sensitive information. Never commit
   > them to version control or share them publicly.

### C. AWS Bedrock - IAM Role

When running in AWS environments (EC2, ECS, Lambda, etc.), IAM roles provide
automatic authentication without managing credentials.

1. Attach an IAM role with Bedrock permissions to your compute resource.

2. Set the AWS region:

   ```bash
   export AWS_REGION="us-east-1"
   ```

3. Start the CLI:

   ```bash
   gemini
   ```

   Gemini CLI will automatically use the IAM role credentials.

### Selecting Claude Models

By default, Gemini CLI uses `anthropic.claude-sonnet-4-5-20250929-v1:0`. To use
a different model, set the model via configuration or command line.

Available Claude models in Bedrock:

- `anthropic.claude-opus-4-5-20251101-v1:0` (Claude Opus 4.5)
- `anthropic.claude-sonnet-4-5-20250929-v1:0` (Claude Sonnet 4.5, default)
- `anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5)
- `anthropic.claude-3-5-sonnet-20241022-v2:0` (Claude 3.5 Sonnet)

For regional availability and the complete list of models, see the
[AWS Bedrock documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html).

### Regional Model Availability

Claude models are available in specific AWS regions. Ensure your `AWS_REGION`
supports your chosen model:

- **us-east-1, us-west-2**: All Claude models
- **eu-west-1, eu-central-1**: Most Claude models
- **ap-southeast-1, ap-northeast-1**: Selected Claude models

If you encounter a model availability error, the CLI will display available
regions for your model and suggest solutions.

## Set your Google Cloud project <a id="set-gcp"></a>

> **Important:** Most individual Google accounts (free and paid) don't require a
> Google Cloud project for authentication.

When you sign in using your Google account, you may need to configure a Google
Cloud project for Gemini CLI to use. This applies when you meet at least one of
the following conditions:

- You are using a Company, School, or Google Workspace account.
- You are using a Gemini Code Assist license from the Google Developer Program.
- You are using a license from a Gemini Code Assist subscription.

To configure Gemini CLI to use a Google Cloud project, do the following:

1.  [Find your Google Cloud Project ID](https://support.google.com/googleapi/answer/7014113).

2.  [Enable the Gemini for Cloud API](https://cloud.google.com/gemini/docs/discover/set-up-gemini#enable-api).

3.  [Configure necessary IAM access permissions](https://cloud.google.com/gemini/docs/discover/set-up-gemini#grant-iam).

4.  Configure your environment variables. Set either the `GOOGLE_CLOUD_PROJECT`
    or `GOOGLE_CLOUD_PROJECT_ID` variable to the project ID to use with Gemini
    CLI. Gemini CLI checks for `GOOGLE_CLOUD_PROJECT` first, then falls back to
    `GOOGLE_CLOUD_PROJECT_ID`.

    For example, to set the `GOOGLE_CLOUD_PROJECT_ID` variable:

    ```bash
    # Replace YOUR_PROJECT_ID with your actual Google Cloud project ID
    export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
    ```

    To make this setting persistent, see
    [Persisting Environment Variables](#persisting-vars).

## Persisting environment variables <a id="persisting-vars"></a>

To avoid setting environment variables for every terminal session, you can
persist them with the following methods:

1.  **Add your environment variables to your shell configuration file:** Append
    the `export ...` commands to your shell's startup file (e.g., `~/.bashrc`,
    `~/.zshrc`, or `~/.profile`) and reload your shell (e.g.,
    `source ~/.bashrc`).

    ```bash
    # Example for .bashrc
    echo 'export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"' >> ~/.bashrc
    source ~/.bashrc
    ```

    > **Warning:** Be aware that when you export API keys or service account
    > paths in your shell configuration file, any process launched from that
    > shell can read them.

2.  **Use a `.env` file:** Create a `.gemini/.env` file in your project
    directory or home directory. Gemini CLI automatically loads variables from
    the first `.env` file it finds, searching up from the current directory,
    then in `~/.gemini/.env` or `~/.env`. `.gemini/.env` is recommended.

    Example for user-wide settings:

    ```bash
    mkdir -p ~/.gemini
    cat >> ~/.gemini/.env <<'EOF'
    GOOGLE_CLOUD_PROJECT="your-project-id"
    # Add other variables like GEMINI_API_KEY as needed
    EOF
    ```

Variables are loaded from the first file found, not merged.

## Running in Google Cloud environments <a id="cloud-env"></a>

When running Gemini CLI within certain Google Cloud environments, authentication
is automatic.

In a Google Cloud Shell environment, Gemini CLI typically authenticates
automatically using your Cloud Shell credentials. In Compute Engine
environments, Gemini CLI automatically uses Application Default Credentials
(ADC) from the environment's metadata server.

If automatic authentication fails, use one of the interactive methods described
on this page.

## Running in headless mode <a id="headless"></a>

[Headless mode](../cli/headless) will use your existing authentication method,
if an existing authentication credential is cached.

If you have not already logged in with an authentication credential, you must
configure authentication using environment variables:

- [Use Gemini API Key](#gemini-api)
- [Vertex AI](#vertex-ai)

## What's next?

Your authentication method affects your quotas, pricing, Terms of Service, and
privacy notices. Review the following pages to learn more:

- [Gemini CLI: Quotas and Pricing](../quota-and-pricing.md).
- [Gemini CLI: Terms of Service and Privacy Notice](../tos-privacy.md).
