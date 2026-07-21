/**
 * A tiny external store for `useSyncExternalStore`. `state` is a stable object
 * mutated in place by `set`, so a captured/destructured reference stays live:
 * read fields off it (`state.foo`) and let hooks snapshot those, rather than
 * watching the whole object by identity (which never changes).
 */
export const createExternalStore = <T extends object>(initial: T) => {
	const state = { ...initial } as T;
	const listeners = new Set<() => void>();

	return {
		state,
		set: (patch: Partial<T>) => {
			Object.assign(state, patch);
			for (const listener of listeners) listener();
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};
