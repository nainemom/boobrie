import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { getRandomMatch } from '../services/user';

/** A deliberate suspense beat before each relay ask, so a match never pops in
 * instantly. Doubles as the poll interval while waiting for someone to appear. */
const SEARCH_DELAY_MS = 2000;
/** How often the searching avatar swaps to a new random face. */
const SHUFFLE_MS = 100;

const randomSeed = () => Math.random().toString(36).slice(2);

export function RandomChatModal({ onClose }: { onClose: () => void }) {
	const [, navigate] = useLocation();
	// `undefined` while searching, otherwise the matched candidate's address.
	const [match, setMatch] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	// A throwaway seed that changes fast while searching, for the shuffle effect.
	const [shuffleSeed, setShuffleSeed] = useState(randomSeed);

	const skipped = useRef<string[]>([]);
	// Bumped on every new search so a stale (delayed) response can't land late.
	const searchId = useRef(0);
	const delayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const searching = match === undefined && error === null;

	const find = useCallback(() => {
		const id = ++searchId.current;
		clearTimeout(delayTimer.current);
		setError(null);
		setMatch(undefined);

		// One poll: wait out the suspense beat, ask the relay, and either settle on
		// a match or — if no one is online yet — go around again.
		const attempt = () => {
			delayTimer.current = setTimeout(() => {
				getRandomMatch(skipped.current)
					.then((res) => {
						if (searchId.current !== id) return;
						if (res.address === null) attempt();
						else setMatch(res.address);
					})
					.catch((err) => {
						if (searchId.current !== id) return;
						setError(err instanceof Error ? err.message : String(err));
					});
			}, SEARCH_DELAY_MS);
		};
		attempt();
	}, []);

	// Search as soon as the modal opens; invalidate any pending work on unmount.
	useEffect(() => {
		find();
		return () => {
			searchId.current++;
			clearTimeout(delayTimer.current);
		};
	}, [find]);

	// Spin the avatar while searching; leave it be once a result is in.
	useEffect(() => {
		if (!searching) return;
		const interval = setInterval(
			() => setShuffleSeed(randomSeed()),
			SHUFFLE_MS,
		);
		return () => clearInterval(interval);
	}, [searching]);

	// Remember this candidate so the relay won't offer them again, then pull the next.
	const skip = () => {
		if (match) skipped.current.push(match);
		find();
	};

	const chat = () => {
		if (!match) return;
		navigate(`/i/${match}`);
		onClose();
	};

	return (
		<Modal>
			<div className="flex flex-col gap-4">
				<div className="flex items-start justify-between gap-3">
					<h3 className="text-2xl font-bold">Talk to a stranger</h3>
					<Button
						iconOnly
						variant="ghost"
						size="base"
						onClick={onClose}
						aria-label="Close"
					>
						<CloseIcon />
					</Button>
				</div>

				{error ? (
					<>
						<p role="alert" className="text-sm text-red-700">
							{error}
						</p>
						<div className="mt-2 flex w-full gap-3">
							<Button variant="outline" className="grow" onClick={onClose}>
								Cancel
							</Button>
							<Button className="grow" onClick={find}>
								Try again
							</Button>
						</div>
					</>
				) : match === undefined ? (
					<>
						<div className="flex flex-col items-center gap-3 py-2">
							<Avatar
								address={shuffleSeed}
								className="size-20 animate-pulse motion-reduce:animate-none"
							/>
							<span className="text-sm text-neutral-500">
								Finding someone online…
							</span>
						</div>
						<Button variant="outline" className="w-full" onClick={onClose}>
							Cancel
						</Button>
					</>
				) : (
					<>
						<div className="flex flex-col items-center gap-3 py-2">
							<Avatar address={match} className="size-20" />
							<span className="w-full truncate text-center text-sm text-neutral-500">
								{match}
							</span>
						</div>
						<div className="mt-2 flex w-full gap-3">
							<Button variant="outline" className="grow" onClick={skip}>
								Skip
							</Button>
							<Button className="grow" onClick={chat}>
								Chat
							</Button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

const CloseIcon = () => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2.5}
		strokeLinecap="round"
		strokeLinejoin="round"
		className="size-4"
		aria-hidden="true"
	>
		<path d="M18 6 6 18M6 6l12 12" />
	</svg>
);
