import { zodResolver } from '@hookform/resolvers/zod';
import { CheckIcon, MoveLeftIcon } from 'lucide-react';
import type { FC } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Divider } from '@/client/components/Divider';
import { FormField } from '@/client/components/FormField';
import { Textarea } from '@/client/components/Textarea';
import { Button } from '../../components/Button';
import { mnemonicSchema } from './constants';

const loginSchema = z.object({
	mnemonic: mnemonicSchema,
});

type LoginForm = z.infer<typeof loginSchema>;

interface SignInStepProps {
	busy: boolean;
	error: string | null;
	onSubmit: (mnemonic: string) => void;
	onBack: () => void;
}

export const SignInStep: FC<SignInStepProps> = ({
	busy,
	error,
	onSubmit,
	onBack,
}) => {
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

	return (
		<form
			onSubmit={handleSubmit(({ mnemonic }) => onSubmit(mnemonic))}
			className="flex flex-col"
		>
			<div className="p-4">
				<h3 className="text-2xl font-bold text-neutral-800 mb-2">
					Welcome back
				</h3>
				<p className="text-sm text-neutral-500 leading-tight">
					Enter the 12 words you saved when you created your identity.
				</p>
			</div>

			<FormField
				className="px-4 mb-4"
				label="Recovery phrase"
				htmlFor="recovery-phrase-input"
				error={errors.mnemonic?.message}
			>
				<Textarea
					className="h-28 w-full rounded-lg border border-neutral-300 bg-white p-3 text-base outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
					placeholder="word1 word2 … word12"
					autoFocus
					autoCapitalize="none"
					{...register('mnemonic')}
				/>
			</FormField>

			{error && <FormField className="px-4 mb-4" error={error} />}

			<Divider />

			<div className="grid grid-cols-3 w-full gap-3 p-4 pt-3">
				<Button
					variant="outline"
					type="button"
					size={12}
					onClick={onBack}
					disabled={busy}
				>
					<MoveLeftIcon size={18} />
					Back
				</Button>
				<Button
					size={12}
					type="submit"
					disabled={busy}
					loading={busy}
					className="col-span-2"
				>
					<CheckIcon size={18} />
					Log In
				</Button>
			</div>
		</form>
	);
};
