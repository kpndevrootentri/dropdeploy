/**
 * Calls an admin API route and returns its `data`, or throws an Error carrying
 * the API's message. Errors arrive as `{ error: { code, message } }` from
 * handleApiError, or as a plain string from a few older routes.
 */
export async function adminRequest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
      : {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.error?.message ?? body?.error ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}
