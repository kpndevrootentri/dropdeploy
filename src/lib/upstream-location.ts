/**
 * The in-app proxy reaches a tenant container at `http://127.0.0.1:{port}`
 * and does not forward the visitor's Host header, so an app that builds
 * absolute redirect URLs from Host (FastAPI's trailing-slash redirect, Flask's
 * `url_for(..., _external=True)`) points them at that internal address. Once
 * the proxy relays redirects instead of following them, the browser would be
 * sent there.
 *
 * Returns `location` moved onto `publicOrigin` when it points at the app's
 * internal address, otherwise `location` unchanged.
 */
export function publicLocation(location: string, port: number, publicOrigin: string): string {
  const internal = `http://127.0.0.1:${port}`;
  if (!location.startsWith(internal)) return location;
  const rest = location.slice(internal.length);
  // Same prefix, different port (`:41234` vs `:4123`) — not this app.
  if (rest !== '' && !/^[/?#]/.test(rest)) return location;
  return publicOrigin + rest;
}
