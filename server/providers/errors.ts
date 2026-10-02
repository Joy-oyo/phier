export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
    public readonly code = 'provider_unavailable',
  ) {
    super(message);
  }
}

/** Never expose upstream response bodies: they may contain prompts or credentials. */
export function safeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as { status?: number; code?: string; name?: string; type?: string };
  if (e?.code === 'credit_balance_exhausted')
    return new ProviderError(
      'Your API provider credits are exhausted. Add credits in its billing settings, then check again.',
      429,
      'credit_balance_exhausted',
    );
  if (e?.status === 401 || ['invalid_api_key', 'invalid_authentication'].includes(e?.code || ''))
    return new ProviderError(
      'The provider API key was rejected. Create or replace the key in .env, then check again.',
      401,
      'invalid_key',
    );
  if (e?.code === 'insufficient_quota' || e?.type === 'insufficient_quota')
    return new ProviderError(
      'The API project has no available quota. Check API billing and project limits.',
      429,
      'quota',
    );
  if (e?.status === 429 || e?.code === 'rate_limit_exceeded')
    return new ProviderError(
      'The API project reached a rate or usage limit. Check billing and limits, then retry.',
      429,
      'rate_limit',
    );
  if (
    e?.status === 403 ||
    e?.status === 404 ||
    ['model_not_found', 'permission_denied'].includes(e?.code || '')
  )
    return new ProviderError(
      'This project cannot access the configured model. Check the model name and API-key permissions.',
      403,
      'model_access',
    );
  if (e?.name === 'AbortError' || e?.name?.includes('Timeout'))
    return new ProviderError(
      'The provider did not respond in time. Check your connection and retry.',
      504,
      'timeout',
    );
  return new ProviderError(
    'The provider request failed. Check internet access and the connection status in Preferences.',
    502,
    'provider_error',
  );
}
