import { LoaderIcon, MessageSquareIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useLocation } from 'wouter';
import { isAnonymous } from '@/shared/auth';
import { sleep } from '@/shared/utils';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { getRandomMatch } from '../services/relay';
import { truncateAddress } from '../utils/address';
import { errorMessage } from '../utils/errors';

/** How often the searching avatar swaps to a new random face. */
const SHUFFLE_MS = 100;

const randomSeed = () => {
	let seed = '';
	do {
		seed = Math.random().toString(36).slice(2);
	} while (!seed || isAnonymous(seed));
	return seed;
};

export function RandomChatModal({ onClose }: { onClose: () => void }) {
	const [, navigate] = useLocation();
	const skipped = useRef<string[]>([]);
	// Bumped on every new search so it's a fresh, un-cached key — a clean
	// "searching" state with no stale data/error, and no need to invalidate a
	// still-pending previous attempt.
	const [attempt, setAttempt] = useState(0);
	// A throwaway seed that changes fast while searching, for the shuffle effect.
	const [shuffleSeed, setShuffleSeed] = useState(randomSeed);

	const search = useSWR(
		`random-match-${attempt}`,
		async () => {
			// Wait out a deliberate suspense beat, so a match never pops in
			// instantly, then ask the relay — and go around again if no one's
			// online yet.
			for (;;) {
				await sleep(2000);
				const res = await getRandomMatch({ exclude: skipped.current });
				if (res.address !== null) return res.address;
			}
		},
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		},
	);

	const find = () => setAttempt((a) => a + 1);

	// Spin the avatar while searching; leave it be once a result is in.
	useEffect(() => {
		if (!search.isLoading) return;
		const interval = setInterval(
			() => setShuffleSeed(randomSeed()),
			SHUFFLE_MS,
		);
		return () => clearInterval(interval);
	}, [search.isLoading]);

	// Remember this candidate so the relay won't offer them again, then pull the next.
	const skip = () => {
		if (search.data) skipped.current.push(search.data);
		find();
	};

	const chat = () => {
		if (!search.data) return;
		navigate(`/i/${search.data}`);
		onClose();
	};

	const errorText = search.error ? errorMessage(search.error) : null;

	return (
		<Modal title="Talk to a stranger" closeButton onClose={onClose}>
			<div className="flex flex-col gap-4">
				{errorText ? (
					<>
						<FormField error={errorText} />
						<FormActions>
							<Button variant="outline" onClick={onClose}>
								Cancel
							</Button>
							<Button className="col-span-2" onClick={find}>
								Try again
							</Button>
						</FormActions>
					</>
				) : search.data === undefined ? (
					<>
						<div className="flex flex-col items-center gap-3 py-2">
							<Avatar address={shuffleSeed} className="size-36" />
							<span className="text-base text-neutral-500 flex items-center gap-1">
								<LoaderIcon size={16} className="animate-spin" /> Finding
								someone online…
							</span>
						</div>
						<FormActions>
							<Button
								size={12}
								variant="outline"
								className="col-span-3"
								onClick={onClose}
							>
								Cancel
							</Button>
						</FormActions>
					</>
				) : (
					<>
						<div className="flex flex-col items-center gap-3 py-2">
							<Avatar address={search.data} className="size-36" />
							<span className="w-full truncate text-center text-base text-neutral-800 font-mono">
								{truncateAddress(search.data)}
							</span>
						</div>
						<FormActions>
							<Button size={12} variant="outline" onClick={skip}>
								Skip
							</Button>
							<Button size={12} className="col-span-2" onClick={chat}>
								<MessageSquareIcon size={16} />
								Chat
							</Button>
						</FormActions>
					</>
				)}
			</div>
		</Modal>
	);
}
