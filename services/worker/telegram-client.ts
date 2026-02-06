import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

/**
 * Telegram Bot API client for sending notifications
 */

interface TelegramApiResponse {
  ok: boolean;
  result?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      type: string;
    };
    date: number;
    text: string;
  };
  description?: string;
  error_code?: number;
}

// Cache bot token in memory (module-level variable)
let cachedToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

export interface TelegramMessage {
  text: string;
  chatId: string;
}

export interface TelegramClientOptions {
  ssmParameterName?: string;
  ssmClient?: SSMClient;
}

/**
 * Gets the Telegram bot token from SSM Parameter Store
 * Token is cached in memory after first fetch
 * @param parameterName SSM parameter name for the bot token
 * @param ssmClient Optional SSM client (creates new one if not provided)
 * @returns Bot token string
 */
export async function getBotToken(
  parameterName: string,
  ssmClient?: SSMClient
): Promise<string> {
  // Return cached token if available
  if (cachedToken) {
    return cachedToken;
  }

  // If a fetch is already in progress, wait for it
  if (tokenPromise) {
    return tokenPromise;
  }

  // Start fetching token
  const client = ssmClient || new SSMClient({});
  tokenPromise = (async () => {
    try {
      const command = new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true, // Required for SecureString parameters
      });

      const response = await client.send(command);
      const token = response.Parameter?.Value;

      if (!token) {
        throw new Error(`SSM parameter ${parameterName} has no value`);
      }

      // Cache the token
      cachedToken = token;
      return token;
    } catch (error) {
      // Clear the promise so we can retry
      tokenPromise = null;
      if (error instanceof Error) {
        throw new Error(`Failed to get bot token from SSM: ${error.message}`);
      }
      throw error;
    }
  })();

  return tokenPromise;
}

/**
 * Sends a message via Telegram Bot API
 * @param message Message to send
 * @param botToken Telegram bot token
 * @returns Message ID if successful, throws error on failure
 */
export async function sendTelegramMessage(
  message: TelegramMessage,
  botToken: string
): Promise<number> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = {
    chat_id: message.chatId,
    text: message.text,
    parse_mode: 'HTML', // Optional: allows HTML formatting
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // Handle non-200 responses as failures
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Telegram API returned status ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as TelegramApiResponse;

  // Telegram API returns { ok: true, result: { message_id: ... } } on success
  if (!data.ok) {
    throw new Error(`Telegram API returned error: ${JSON.stringify(data)}`);
  }

  const messageId = data.result?.message_id;
  if (typeof messageId !== 'number') {
    throw new Error(`Invalid response from Telegram API: missing message_id`);
  }

  return messageId;
}

/**
 * Sends a message using bot token from SSM
 * Combines token fetching and message sending
 * @param message Message to send
 * @param options Optional client configuration
 * @returns Message ID if successful
 */
export async function sendMessage(
  message: TelegramMessage,
  options: TelegramClientOptions = {}
): Promise<number> {
  const parameterName =
    options.ssmParameterName || process.env.TELEGRAM_TOKEN_PARAM || '';

  if (!parameterName) {
    throw new Error('Telegram token parameter name not provided');
  }

  const token = await getBotToken(parameterName, options.ssmClient);
  return sendTelegramMessage(message, token);
}

/**
 * Clears the cached bot token (useful for testing or token rotation)
 */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenPromise = null;
}
