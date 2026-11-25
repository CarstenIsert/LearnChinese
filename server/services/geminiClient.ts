import { GoogleGenAI } from '@google/genai';

export const PLACEHOLDER_API_KEY = 'your_gemini_api_key_here';

export function getApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

export function isValidApiKey(apiKey?: string | null): boolean {
  const key = (apiKey ?? '').trim();
  return Boolean(key && key !== PLACEHOLDER_API_KEY);
}

export function hasValidApiKey(): boolean {
  return isValidApiKey(getApiKey());
}

export function getGeminiClient(apiKeyOverride?: string): GoogleGenAI {
  const key = (apiKeyOverride ?? getApiKey()).trim();
  if (!isValidApiKey(key)) {
    throw new Error('GEMINI_API_KEY missing or invalid');
  }
  return new GoogleGenAI({ apiKey: key });
}
