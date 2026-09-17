import { Share2Icon } from 'lucide-react';
import { useCallback } from 'react';
import { useCopyToClipboard } from './useCopyToClipboard';

/** Whether this browser can open the OS share sheet at all. Read once, at
 * module scope: it's a fact about the browser, not about a render. Desktop
 * Firefox has no sheet, and every browser hides the API outside a secure
 * context — so this is `false` more often than the phone it's designed for
 * suggests. */
const canShare = typeof navigator.share === 'function';

/**
 * Hands a url to the OS share sheet. Same shape as {@link useCopyToClipboard} —
 * an icon and the action that goes with it — so the two are interchangeable at
 * a call site.
 *
 * Which matters, because where there is no sheet this *is*
 * {@link useCopyToClipboard}: the button copies instead, and wears the
 * clipboard's icon (tick and all) rather than promising a sheet that isn't
 * coming.
 */
export const useOsShare = () => {
	const [CopyIcon, copyToClipboard] = useCopyToClipboard();

	const share = useCallback(
		(url: string) => {
			if (!canShare) {
				copyToClipboard(url);
				return;
			}
			// Dismissing the sheet rejects with `AbortError` — a perfectly ordinary
			// way for this to end, not a failure. Nothing here is worth surfacing
			// either way: whatever happened, the user was looking right at it.
			navigator.share({ url }).catch(() => undefined);
		},
		[copyToClipboard],
	);

	return [canShare ? Share2Icon : CopyIcon, share] as const;
};
