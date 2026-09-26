/**
 * The unread badge — the number that tells you there's something waiting
 * without opening the app. It lives in two places, both driven from the one
 * total:
 *
 * - The **app icon** (home screen, dock, taskbar), through the Badging API.
 *   Only an *installed* copy has an icon to badge; in a plain tab the call is
 *   a no-op, and browsers without the API (Firefox) are skipped entirely. iOS
 *   additionally needs notification permission before it shows anything.
 * - The **tab title**, as a `(3)` prefix — browsers have no badge for a tab's
 *   icon, and the title is where every chat app puts the count instead.
 *
 * The service worker only has half of this job: on a push it can't decrypt the
 * local database to know the real total, so it sets a plain dot (see `sw.ts`),
 * and this module replaces it with the real number the next time the app looks.
 */

import { useEffect } from 'react';
import { useConversations } from './chat';

const baseTitle = document.title;
const BLINK_TITLE = '💬 New message';
const BLINK_INTERVAL = 1000;

/** The unread total as last reported. */
let unread = 0;
/** The total when the tab was last hidden — anything above it arrived while
 * you were away, and that's what earns a blink. */
let unreadWhenHidden = 0;
let blinkTimer: ReturnType<typeof setInterval> | undefined;

const countTitle = () => (unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle);

/** Alternate the title with {@link BLINK_TITLE}, so a background tab moves
 * among still ones. Browsers can't animate the tab itself; this is the trick
 * every chat app falls back on. */
function startBlinking(): void {
	if (blinkTimer) return;
	blinkTimer = setInterval(() => {
		document.title =
			document.title === BLINK_TITLE ? countTitle() : BLINK_TITLE;
	}, BLINK_INTERVAL);
}

function stopBlinking(): void {
	clearInterval(blinkTimer);
	blinkTimer = undefined;
	document.title = countTitle();
}

document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		unreadWhenHidden = unread;
		return;
	}
	stopBlinking();
	// The service worker may have replaced the number with a dot while the app
	// sat in the background; put the real one back now it's looked at.
	void setAppBadge(unread).catch(() => {});
});

async function setAppBadge(count: number): Promise<void> {
	if (!('setAppBadge' in navigator)) return;
	if (count > 0) await navigator.setAppBadge(count);
	else await navigator.clearAppBadge();
}

/** Show `count` unread messages everywhere the app can, or clear it at 0. A
 * count that grows while the tab is in the background also starts the title
 * blinking, until the tab is looked at again. */
export async function setUnreadBadge(count: number): Promise<void> {
	unread = count;
	if (count === 0) stopBlinking();
	else if (document.hidden && count > unreadWhenHidden) startBlinking();
	// While blinking, the next tick picks the new count up.
	if (!blinkTimer) document.title = countTitle();
	await setAppBadge(count).catch(() => {});
}

/** Keep the badge on the live unread total for as long as it's mounted. Mount
 * it once, above the routes, so it keeps counting whichever page is open. */
export function useUnreadBadge(): void {
	const conversations = useConversations();
	const loaded = conversations !== undefined;
	const total =
		conversations?.reduce((sum, { unreadCount }) => sum + unreadCount, 0) ?? 0;

	useEffect(() => {
		// Not while the first read is still loading — that would clear a badge
		// that is about to be set right back.
		if (!loaded) return;
		void setUnreadBadge(total);
	}, [loaded, total]);
}
