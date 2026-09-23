import { zodResolver } from '@hookform/resolvers/zod';
import { CheckIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import useSWRMutation from 'swr/mutation';
import { z } from 'zod';
import { isValidMnemonic } from '@/shared/mnemonic';
import { Button } from '../../components/Button';
import { Form } from '../../components/Form';
import { FormField } from '../../components/FormField';
import { PageActions, PageBody } from '../../components/Page';
import { Textarea } from '../../components/Textarea';
import { login } from '../../services/auth';
import { errorMessage } from '../../utils/errors';
import { AuthLayout, useAuthFlow } from './lib';

const loginSchema = z.object({
	mnemonic: z
		.string()
		.trim()
		.min(1, 'Enter your recovery phrase')
		.refine(isValidMnemonic, 'That doesn’t look like a valid recovery phrase.'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginStep() {
	const flow = useAuthFlow();
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

	const loginMutation = useSWRMutation(
		'auth/login',
		(_key: string, { arg }: { arg: { mnemonic: string } }) => login(arg),
	);
	const busy = loginMutation.isMutating;

	const submit = async ({ mnemonic }: LoginForm) => {
		try {
			await loginMutation.trigger({ mnemonic });
			flow.done();
		} catch {
			// Already on `loginMutation.error`, and rendered below.
		}
	};

	return (
		<AuthLayout
			title="Welcome back"
			subtitle="Enter the 12 words you saved when you created your identity."
			back={busy ? undefined : flow.link('/auth')}
		>
			<Form onSubmit={handleSubmit(submit)} className="min-h-0 flex-1 gap-0">
				<PageBody>
					<FormField
						label="Recovery phrase"
						htmlFor="recovery-phrase-input"
						error={errors.mnemonic?.message}
						description="Separate words with spaces, new lines, commas, hyphens, or underscores."
						vertical
					>
						<Textarea
							id="recovery-phrase-input"
							className="w-full min-h-48"
							size={12}
							placeholder="word1 word2 … word12"
							autoFocus
							autoCapitalize="none"
							{...register('mnemonic')}
						/>
					</FormField>

					{loginMutation.error && (
						<FormField error={errorMessage(loginMutation.error)} />
					)}
				</PageBody>

				<PageActions>
					<Button type="submit" size={12} loading={busy} className="w-full">
						<CheckIcon size={18} />
						Log In
					</Button>
				</PageActions>
			</Form>
		</AuthLayout>
	);
}
