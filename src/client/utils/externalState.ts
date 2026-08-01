import { useSyncExternalStore } from 'react';

export const createExternalState = <T>(initial: T) => {
	const listeners = new Set<(state: T) => void>();

	const store = {
		state: initial,
		set: (newState: T) => {
			store.state = newState;
			for (const listener of listeners) listener(newState);
		},
		/** Merge a partial update into the current state — for object-shaped
		 * state where callers only ever change a few fields at a time. */
		patch: (partial: Partial<T>) => {
			store.set({ ...store.state, ...partial });
		},
		subscribe: (listener: (state: T) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return store;
};

export const useExternalState = <T>(
	store: ReturnType<typeof createExternalState<T>>,
) => {
	return useSyncExternalStore(store.subscribe, () => store.state);
};
