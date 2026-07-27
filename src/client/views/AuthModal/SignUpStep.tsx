import { zodResolver } from '@hookform/resolvers/zod';
import { CheckIcon, MoveLeftIcon, WandIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';
import { z } from 'zod';
import { Divider } from '@/client/components/Divider';
import { FormField } from '@/client/components/FormField';
import { Input } from '@/client/components/Input';
import { handleSchema } from '@/shared/protocol';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Signature } from '../../components/Signature';
import { generate } from '../../services/auth';
import { apiErrorMessage, isConflict } from './constants';

const signUpSchema = z.object({
	handle: handleSchema,
});

type SignUpForm = z.infer<typeof signUpSchema>;

interface SignUpStepProps {
	busy: boolean;
	onSubmit: (mnemonic: string, handle: string) => Promise<void>;
	onBack: () => void;
}

export const SignUpStep: FC<SignUpStepProps> = ({ busy, onSubmit, onBack }) => {
	const [index, setIndex] = useState(0);

	const draft = useSWR(`draft-identity-${index}`, generate, {
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
		keepPreviousData: true,
	});
	const address = draft.data?.address;

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<SignUpForm>({
		resolver: zodResolver(signUpSchema),
	});

	const submit = async ({ handle }: SignUpForm) => {
		if (!draft.data?.mnemonic) return;
		try {
			await onSubmit(draft.data.mnemonic, handle);
		} catch (err) {
			setError('handle', {
				type: 'manual',
				message: isConflict(err)
					? 'That handle is already taken.'
					: apiErrorMessage(err, 'Something went wrong. Please try again.'),
			});
		}
	};

	return (
		<form onSubmit={handleSubmit(submit)} className="flex flex-col w-full">
			<h3 className="text-2xl font-bold text-neutral-800 p-4">
				Create your identity
			</h3>

			{/* Avatar and Signature Static Preview */}
			<FormField
				className="px-4 mb-4"
				label="Avatar & Signature"
				htmlFor="address-button"
			>
				<div className="relative flex w-full flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-3 gap-3">
					<div className="flex items-center gap-1 px-3 h-32 justify-between w-full bg-neutral-100 border border-neutral-200 rounded-md">
						{address && (
							<>
								<Avatar address={address} className="size-32 shrink-0" />
								<Signature
									address={address}
									className="text-neutral-700 h-32"
								/>
							</>
						)}
					</div>
					<Button
						id="address-button"
						variant="outline"
						size={10}
						type="button"
						onClick={() => setIndex((i) => i + 1)}
						disabled={busy}
						loading={draft.isLoading}
						className="shrink-0 w-full"
						autoFocus
					>
						<WandIcon size={16} /> Generate
					</Button>
				</div>
			</FormField>

			{/* Handle Row */}
			<FormField
				label="Handle"
				htmlFor="handle-input"
				className="px-4 pb-4"
				error={errors.handle?.message}
			>
				<Input
					id="handle-input"
					placeholder="Choose a handle"
					className="min-w-0 grow"
					size={12}
					disabled={busy}
					autoCapitalize="none"
					{...register('handle')}
				/>
			</FormField>

			<Divider />

			{/* Bottom Actions */}
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
					disabled={!address}
					loading={busy}
					className="col-span-2"
				>
					<CheckIcon size={18} />
					Sign Up
				</Button>
			</div>
		</form>
	);
};
