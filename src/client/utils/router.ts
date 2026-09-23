import { createExternalState, useExternalState } from './externalState';

const isExternalOpen = createExternalState(true);

for (const event of ['pushState', 'replaceState', 'popstate']) {
	window.addEventListener(event, () => isExternalOpen.set(false));
}

export const useIsExternalOpen = () => useExternalState(isExternalOpen);
