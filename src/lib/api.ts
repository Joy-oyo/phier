export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Phier-Client': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const result = await response
      .json()
      .catch(() => ({ error: 'The server is unavailable. Please try again.' }));
    throw new Error(result.error || 'Request failed.');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
