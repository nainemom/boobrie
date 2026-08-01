/**
 * Turns a fallible async task into a driver that's safe to trigger from
 * several independent places at once (a new item queued, a reconnect, a
 * poll): overlapping triggers coalesce into at most one run in flight plus
 * one more queued right behind it, and a failed run schedules its own retry
 * after `retryMs`, repeating until it succeeds.
 *
 * The retry re-enters through the same `trigger`, not a direct re-call of
 * `task` — so it's still subject to the single-flight gate rather than
 * risking a concurrent second run alongside whatever triggered it.
 */
export function createRetryingTask(task: () => Promise<void>, retryMs: number) {
	let running = false;
	let again = false;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	function trigger(): void {
		if (running) {
			again = true;
			return;
		}
		running = true;
		task()
			.catch((error) => {
				console.error('Task failed; will retry:', error);
				if (!retryTimer) {
					retryTimer = setTimeout(() => {
						retryTimer = null;
						trigger();
					}, retryMs);
				}
			})
			.finally(() => {
				running = false;
				if (again) {
					again = false;
					trigger();
				}
			});
	}

	return {
		trigger,
		/** Cancel a pending retry. Doesn't interrupt a run already in flight. */
		stop: () => {
			if (retryTimer) clearTimeout(retryTimer);
			retryTimer = null;
		},
	};
}
