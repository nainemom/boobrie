/**
 * The pieces every auth step shares: where the flow ends up, and the frame it
 * is drawn in. The steps themselves each live in their own file next to this
 * one, and are dispatched by {@link file://./index.tsx}.
 */

import { ChevronLeftIcon } from 'lucide-react';
import { type FC, type ReactNode, useCallback } from 'react';
import { Link, useLocation, useSearch, useSearchParams } from 'wouter';
import { Button } from '../../components/Button';
import { Navbar } from '../../components/Navbar';
import { Page } from '../../components/Page';
import { useAuth } from '../../services/auth';
import { useIsExternalOpen } from '../../utils/router';

// --- the flow ------------------------------------------------------------

/** Addresses are base58, and that's the only thing `peer` is ever allowed to
 * be — a query parameter is whatever the URL says it is, so it's checked before
 * anything navigates anywhere on it. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** The gate pointed at one person: the choose step, asking which account is
 * answering them. Built here so every way in — a handle link, a chat followed
 * into from outside, a visitor with no identity yet — spells the query the
 * same way. */
export const gateHref = (peer?: string) =>
	`/auth${peer ? `?peer=${encodeURIComponent(peer)}` : ''}`;

/**
 * The redirect a page owes whoever is looking at it, or null when they can
 * stay. Every page that needs somebody signed in starts with this — and asking
 * is the whole of what makes a page private, so `/auth` and a handle link are
 * public by simply not asking.
 *
 * `peer` is for a chat: the answer there isn't the plain auth page but the gate
 * pointed at that person, so signing in lands back in the conversation the link
 * was for instead of the conversation list.
 */
export function useAuthRedirect(peer?: string) {
	const { identity } = useAuth();
	const isExternalOpen = useIsExternalOpen();

	if (!identity || (isExternalOpen && peer)) return gateHref(peer);

	return null;
}

export interface AuthFlow {
	/** Where the user ends up once they're in: the chat they followed a link
	 * to, or the conversation list for anything else. */
	to: string;
	/** The person that chat is with, when the flow is answering a link to one —
	 * every step can say who's waiting on the other end. Null for a plain visit
	 * to the auth page. */
	peer: string | null;
	/** Send them there. */
	done: () => void;
	/** Another step's href, with `peer` carried along — without this the person
	 * being written to is lost the moment somebody taps "Log In". */
	link: (step: string) => string;
}

/** Every step needs the same two things: somewhere to end up, and hrefs for its
 * siblings. Sharing one hook keeps the `peer` rule in a single place. */
export function useAuthFlow(): AuthFlow {
	const [, navigate] = useLocation();
	const [searchParams] = useSearchParams();
	const search = useSearch();

	const param = searchParams.get('peer');
	const peer = param && ADDRESS.test(param) ? param : null;
	const to = peer ? `/i/${peer}` : '/';

	return {
		to,
		peer,
		// Replace rather than push: these pages are a gate, not somewhere the
		// back button should land you again once you're through.
		done: useCallback(() => navigate(to, { replace: true }), [navigate, to]),
		link: (step) => `${step}${search ? `?${search}` : ''}`,
	};
}

// --- the shell -----------------------------------------------------------

/** The frame every step shares: its name up top, a way back where there is one,
 * and a line explaining the screen that doesn't scroll away with the content. */
export const AuthLayout: FC<{
	title?: string;
	subtitle?: string;
	/** Href of the step to go back to. Omitted where there's nowhere to go. */
	back?: string;
	children: ReactNode;
}> = ({ title, subtitle, back, children }) => (
	<Page>
		<Navbar
			middle={title && <h1 className="text-xl font-bold">{title}</h1>}
			start={
				back && (
					<Link href={back} replace aria-label="Back" className="contents">
						<Button size={12} variant="transparent" iconOnly>
							<ChevronLeftIcon />
						</Button>
					</Link>
				)
			}
		/>
		{subtitle && (
			<p className="shrink-0 px-3 pb-1 text-sm text-neutral-500">{subtitle}</p>
		)}
		{children}
	</Page>
);

/** A single block floated in the middle of the screen — the shape the steps use
 * when they have no form to fill in. `m-auto` rather than `justify-center` so a
 * short screen scrolls instead of clipping the top. */
export const AuthHero: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex flex-1 flex-col overflow-y-auto">
		<div className="m-auto flex w-full flex-col items-center gap-6 p-6 text-center">
			{children}
		</div>
	</div>
);
