import { CheckIcon, MoveLeftIcon } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { Divider } from '@/client/components/Divider';
import { FormField } from '@/client/components/FormField';
import { Input } from '@/client/components/Input';
import { Button } from '../../components/Button';

interface RememberStepProps {
	phrase: string;
	onDone: () => void;
}

export const RememberStep: FC<RememberStepProps> = ({ phrase, onDone }) => {
	const words = phrase.split(' ');
	const [checkIndex, setCheckIndex] = useState<number | null>(null);
	const [guess, setGuess] = useState('');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, []);

	const startCheck = () => {
		setError(null);
		setGuess('');
		setCheckIndex(Math.floor(Math.random() * words.length));
	};

	const submitCheck = () => {
		if (checkIndex === null || !guess.trim()) return;
		if (guess.trim().toLowerCase() === words[checkIndex]) {
			onDone();
		} else {
			setError("That's not it — check your saved phrase and try again.");
			setCheckIndex(null);
		}
	};

	if (checkIndex !== null) {
		return (
			<div className="flex flex-col">
				<div className="p-4">
					<h3 className="text-2xl font-bold text-neutral-800 mb-2">
						Quick check
					</h3>
					<p className="text-sm text-neutral-500 leading-tight">
						What's word {checkIndex + 1} of your recovery phrase?
					</p>
				</div>

				<FormField
					label={`Word ${checkIndex + 1}`}
					htmlFor="check-word-input"
					className="px-4 pb-4"
				>
					<Input
						id="check-word-input"
						size={12}
						autoFocus
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						value={guess}
						onChange={(e) => setGuess(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && submitCheck()}
					/>
				</FormField>

				<Divider />

				<div className="grid grid-cols-3 w-full gap-3 p-4 pt-3">
					<Button
						variant="outline"
						size={12}
						onClick={() => setCheckIndex(null)}
					>
						<MoveLeftIcon size={18} />
						Back
					</Button>
					<Button
						size={12}
						onClick={submitCheck}
						disabled={!guess.trim()}
						className="col-span-2"
					>
						<CheckIcon size={18} />
						Confirm
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="p-4">
				<h3 className="text-2xl font-bold text-neutral-800 mb-2">
					Save your recovery phrase
				</h3>
				<p className="text-sm text-neutral-500 leading-tight">
					These 12 words are the only way back into this account. Write them
					down and keep them somewhere safe.
				</p>
			</div>

			<FormField label="Recovery phrase" error={error} className="px-4 pb-4">
				<ol className="grid grid-cols-3 gap-2">
					{words.map((word, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-order phrase, words may repeat, never reordered
							key={`${index}-${word}`}
							className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2"
						>
							<span className="text-xs text-neutral-400 font-mono">
								{(index + 1).toString().padStart(2, '0')}
							</span>
							<span className="font-medium select-text">{word}</span>
						</li>
					))}
				</ol>
			</FormField>

			<Divider />

			<div className="mt-2 w-full p-4 pt-3">
				<Button size={12} onClick={startCheck} className="w-full">
					<CheckIcon size={18} />
					I've Saved It
				</Button>
			</div>
		</div>
	);
};
