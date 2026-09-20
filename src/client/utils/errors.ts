/** A human-readable message for a thrown error. Prefers the relay's own JSON
 * error body — every failure it answers with is `{ error }`, shaped in one place
 * ({@link file://../../relay/main.ts}) — over the generic wrapper ofetch puts
 * around it ("[POST] url: 409 Conflict"), falling back to a plain `Error#message`
 * (a browser API refusing, say) or the given fallback for anything else. */
export function errorMessage(
	error: unknown,
	fallback = 'Something went wrong. Please try again.',
): string {
	const data = (error as { data?: { error?: string } } | null)?.data;
	if (data?.error) return data.error;
	if (error instanceof Error) return error.message;
	return fallback;
}
