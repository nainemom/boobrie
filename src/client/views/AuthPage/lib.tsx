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

// --- the flow ------------------------------------------------------------

/** A chat with one particular person — the only `callback_url` worth honouring,
 * and narrow enough that nothing pointing off-site can slip through. Addresses
 * are base58, so no separator or escape ever appears inside one. */
const CHAT_PATH = /^\/i\/[1-9A-HJ-NP-Za-km-z]+$/;

export interface AuthFlow {
	/** Where the user ends up once they're in: the chat they followed a link
	 * to, or the conversation list for anything else. */
	to: string;
	/** Send them there. */
	done: () => void;
	/** Another step's href, with `callback_url` carried along — without this a
	 * shared chat link is lost the moment somebody taps "Log In". */
	link: (step: string) => string;
}

/** Every step needs the same two things: somewhere to end up, and hrefs for its
 * siblings. Sharing one hook keeps the `callback_url` rule in a single place. */
export function useAuthFlow(): AuthFlow {
	const [, navigate] = useLocation();
	const [searchParams] = useSearchParams();
	const search = useSearch();

	const target = searchParams.get('callback_url');
	const to = target && CHAT_PATH.test(target) ? target : '/';

	return {
		to,
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
