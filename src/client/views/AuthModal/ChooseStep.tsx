import { HatGlassesIcon, UserKeyIcon, UserPlusIcon } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '../../components/Button';
import { Divider } from '../../components/Divider';
import { FormField } from '../../components/FormField';
import { AuthCarousel } from './AuthCarousel';
import type { AUTH_STEPS } from './constants';

interface ChooseStepProps {
	busy: boolean;
	error: string | null;
	onGoAnonymous: () => void;
	onSelect: (newStep: (typeof AUTH_STEPS)[number]) => void;
}

export const ChooseStep: FC<ChooseStepProps> = ({
	busy,
	error,
	onGoAnonymous,
	onSelect,
}) => {
	return (
		<div>
			<AuthCarousel />
			<div className="flex flex-col w-full gap-3 p-4 pb-3">
				<Button
					variant="outline"
					size={12}
					onClick={onGoAnonymous}
					loading={busy}
					className="w-full"
				>
					<HatGlassesIcon size={20} />
					Go Anonymous
				</Button>
				{error && <FormField error={error} />}
			</div>
			<Divider label="Or" />
			<div className="grid grid-cols-2 w-full gap-3 p-4 pt-3">
				<Button
					variant="outline"
					onClick={() => onSelect('signin')}
					size={12}
					disabled={busy}
				>
					<UserKeyIcon size={20} />
					Log In
				</Button>
				<Button
					variant="primary"
					size={12}
					onClick={() => onSelect('signup')}
					disabled={busy}
				>
					<UserPlusIcon size={20} />
					Sign Up
				</Button>
			</div>
		</div>
	);
};
