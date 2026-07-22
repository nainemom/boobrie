/**
 * The relay transport — a thin `fetch` wrapper every relay call goes through,
 * plus where the relay lives and the auth headers each call carries. The domain
 * services (auth, user, chat) build their endpoints on this; it knows nothing
 * about *what* is being fetched.
 *
 * Client-only: only the client talks *to* the relay, so this lives here (not in
 * `shared`); the relay server never imports it.
 */

/** Where the relay lives. Set VITE_RELAY_URL in .env to point elsewhere. */
export const RELAY_URL =
	import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

/** Fetch a relay endpoint (a path relative to {@link RELAY_URL}), throwing a
 * useful error on a non-2xx response. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(new URL(path, RELAY_URL).toString(), init);
	if (!res.ok) {
		let detail = '';
		try {
			detail = ((await res.json()) as { error?: string }).error ?? '';
		} catch {
			// non-JSON error body; fall back to the status
		}
		throw new Error(detail || `Request to ${path} failed (${res.status})`);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

/** A `Bearer` auth header for a relay session token. */
export const authHeaders = (token: string): HeadersInit => ({
	Authorization: `Bearer ${token}`,
});

/** Auth header plus JSON content-type, for requests that carry a body. */
export const jsonHeaders = (token: string): HeadersInit => ({
	'content-type': 'application/json',
	...authHeaders(token),
});
