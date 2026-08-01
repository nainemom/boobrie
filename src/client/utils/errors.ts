/** A human-readable message for a thrown error. Prefers an API's own JSON
 * error body (e.g. ofetch's `.data.message`) over its generic `.message`
 * wrapper (ofetch's own "[POST] url: 404 Not Found"), falling back to a plain
 * `Error#message` or the given fallback for anything else. */
export function errorMessage(
	error: unknown,
	fallback = 'Something went wrong. Please try again.',
): string {
	const data = (error as { data?: { message?: string } } | null)?.data;
	if (data?.message) return data.message;
	if (error instanceof Error) return error.message;
	return fallback;
}
