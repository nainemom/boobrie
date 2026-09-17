import { useState } from 'react';

export const usePromiseLoading = <T extends (...args: never[]) => unknown>(
	action?: T,
) => {
	const [localLoading, setLocalLoading] = useState(false);

	return [
		localLoading,
		(...args: Parameters<T>) => {
			const resp = action?.(...args);
			if (resp instanceof Promise) {
				setLocalLoading(true);
				resp.finally(() => setLocalLoading(false));
			}
			return resp;
		},
	] as const;
};
