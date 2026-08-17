import type { InternalClaimPlans } from '@documenso/ee/server-only/stripe/get-internal-claim-plans';
import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { AppError } from '@documenso/lib/errors/app-error';
import { INTERNAL_CLAIM_ID } from '@documenso/lib/types/subscription';
import { parseMessageDescriptorMacro } from '@documenso/lib/utils/i18n';
import { isPersonalLayout } from '@documenso/lib/utils/organisations';
import { trpc } from '@documenso/trpc/react';
import { ZCreateOrganisationRequestSchema } from '@documenso/trpc/server/organisation-router/create-organisation.types';
import { cn } from '@documenso/ui/lib/utils';
import { Badge } from '@documenso/ui/primitives/badge';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { SpinnerBox } from '@documenso/ui/primitives/spinner';
import { Tabs, TabsList, TabsTrigger } from '@documenso/ui/primitives/tabs';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type * as DialogPrimitive from '@radix-ui/react-dialog';
import { ExternalLinkIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { match } from 'ts-pattern';
import type { z } from 'zod';

import { IndividualPersonalLayoutCheckoutButton } from '../general/billing-plans';

export type OrganisationCreateDialogProps = {
  trigger?: React.ReactNode;
} & Omit<DialogPrimitive.DialogProps, 'children'>;

export const ZCreateOrganisationFormSchema = ZCreateOrganisationRequestSchema.pick({
  name: true,
});

export type TCreateOrganisationFormSchema = z.infer<typeof ZCreateOrganisationFormSchema>;

export const OrganisationCreateDialog = ({ trigger, ...props }: OrganisationCreateDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const { refreshSession, organisations } = useSession();

  const [searchParams] = useSearchParams();
  const updateSearchParams = useUpdateSearchParams();
  const isPersonalLayoutMode = isPersonalLayout(organisations);

  const actionSearchParam = searchParams?.get('action');

  const [step, setStep] = useState<'billing' | 'create'>(IS_BILLING_ENABLED() ? 'billing' : 'create');

  const [selectedPriceId, setSelectedPriceId] = useState<string>('');

  const [open, setOpen] = useState(false);

  const form = useForm({
    resolver: zodResolver(ZCreateOrganisationFormSchema),
    defaultValues: {
      name: '',
    },
  });

  const { mutateAsync: createOrganisation } = trpc.organisation.create.useMutation();

  const { data: plansData } = trpc.enterprise.billing.plans.get.useQuery(undefined, {
    enabled: IS_BILLING_ENABLED(),
  });

  const onFormSubmit = async ({ name }: TCreateOrganisationFormSchema) => {
    try {
      const response = await createOrganisation({
        name,
        priceId: selectedPriceId,
      });

      if (response.paymentRequired) {
        window.open(response.checkoutUrl, '_blank');
        setOpen(false);

        return;
      }

      await refreshSession();
      setOpen(false);

      toast({
        title: t`Success`,
        description: t`Your organisation has been created.`,
        duration: 5000,
      });
    } catch (err) {
      const error = AppError.parseError(err);

      console.error(error);

      toast({
        title: t`An unknown error occurred`,
        description: t`We encountered an unknown error while attempting to create a organisation. Please try again later.`,
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (actionSearchParam === 'add-organisation') {
      setOpen(true);
      updateSearchParams({ action: null });
    }
  }, [actionSearchParam, open]);

  useEffect(() => {
    form.reset();
  }, [open, form]);

  const isIndividualPlan = (priceId: string) => {
    return (
      plansData?.plans[INTERNAL_CLAIM_ID.INDIVIDUAL]?.monthlyPrice?.id === priceId ||
      plansData?.plans[INTERNAL_CLAIM_ID.INDIVIDUAL]?.yearlyPrice?.id === priceId
    );
  };

  return (
    <Dialog {...props} open={open} onOpenChange={(value) => !form.formState.isSubmitting && setOpen(value)}>
      <DialogTrigger onClick={(e) => e.stopPropagation()} asChild={true}>
        {trigger ?? (
          <Button className="flex-shrink-0" variant="secondary">
            <Trans>Create organisation</Trans>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent position="center">
        {match(step)
          .with('billing', () => (
            <>
              <DialogHeader>
                <DialogTitle>
                  <Trans>Select a plan</Trans>
                </DialogTitle>

                <DialogDescription>
                  <Trans>Select a plan to continue</Trans>
                </DialogDescription>
              </DialogHeader>
              <fieldset aria-label="Plan select">
                {plansData ? (
                  <BillingPlanForm
                    value={selectedPriceId}
                    onChange={setSelectedPriceId}
                    plans={plansData.plans}
                    canCreateFreeOrganisation={plansData.canCreateFreeOrganisation}
                  />
                ) : (
                  <SpinnerBox className="py-32" />
                )}
              </fieldset>

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setOpen(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>

                {isIndividualPlan(selectedPriceId) ? (
                  <IndividualPersonalLayoutCheckoutButton
                    priceId={selectedPriceId}
                    disabled={!selectedPriceId}
                    className="w-full"
                  >
                    <Trans>Continue</Trans>
                  </IndividualPersonalLayoutCheckoutButton>
                ) : (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!selectedPriceId}
                    onClick={() => setStep('create')}
                  >
                    <Trans>Continue</Trans>
                  </Button>
                )}
              </DialogFooter>
            </>
          ))
          .with('create', () => (
            <>
              <DialogHeader>
                <DialogTitle>
                  <Trans>Create organisation</Trans>
                </DialogTitle>

                <DialogDescription>
                  <Trans>Enter the name of your new organisation.</Trans>
                </DialogDescription>
              </DialogHeader>

              <Form {...form}>
                <form
                  id="create-organisation-form"
                  onSubmit={form.handleSubmit(onFormSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans>Organisation name</Trans>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder={t`My Organisation`} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  disabled={form.formState.isSubmitting}
                  onClick={() => (IS_BILLING_ENABLED() ? setStep('billing') : setOpen(false))}
                >
                  {IS_BILLING_ENABLED() ? <Trans>Back</Trans> : <Trans>Cancel</Trans>}
                </Button>

                <Button
                  type="submit"
                  form="create-organisation-form"
                  className="flex-1"
                  loading={form.formState.isSubmitting}
                >
                  <Trans>Create</Trans>
                </Button>
              </DialogFooter>
            </>
          )}
          .exhaustive()}
      </DialogContent>
    </Dialog>
  );
};

type BillingPlanFormProps = {
  value: string;
  onChange: (value: string) => void;
  plans: InternalClaimPlans;
  canCreateFreeOrganisation?: boolean;
};

const BillingPlanForm = ({
  value,
  onChange,
  plans,
  canCreateFreeOrganisation,
}: BillingPlanFormProps) => {
  const { t } = useLingui();

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const plansList = useMemo(() => {
    return Object.entries(plans)
      .map(([id, plan]) => ({
        id,
        name: parseMessageDescriptorMacro(plan.name as unknown as MessageDescriptor),
        description: parseMessageDescriptorMacro(plan.description as unknown as MessageDescriptor),
        monthlyPrice: plan.monthlyPrice,
        yearlyPrice: plan.yearlyPrice,
      }))
      .filter((plan) => {
        if (plan.id === INTERNAL_CLAIM_ID.FREE) {
          return canCreateFreeOrganisation;
        }

        return plan.id !== INTERNAL_CLAIM_ID.ENTERPRISE;
      });
  }, [plans, canCreateFreeOrganisation]);

  return (
    <div className="flex flex-col space-y-4">
      <Tabs
        value={billingCycle}
        onValueChange={(v) => setBillingCycle(v as 'monthly' | 'yearly')}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="monthly">
            <Trans>Monthly</Trans>
          </TabsTrigger>
          <TabsTrigger value="yearly">
            <Trans>Yearly</Trans>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 gap-4">
        {plansList.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() =>
              onChange(
                (billingCycle === 'monthly' ? plan.monthlyPrice?.id : plan.yearlyPrice?.id) ?? '',
              )
            }
            className={cn(
              'relative flex flex-col items-start space-y-1 rounded-lg border-2 p-4 text-left transition-colors hover:bg-muted/50',
              value === (billingCycle === 'monthly' ? plan.monthlyPrice?.id : plan.yearlyPrice?.id)
                ? 'border-primary bg-primary/5'
                : 'border-transparent bg-muted/30',
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="font-semibold">{plan.name}</span>
              <span className="text-sm font-medium">
                {match(billingCycle)
                  .with('monthly', () =>
                    plan.monthlyPrice
                      ? t`${(plan.monthlyPrice.amount / 100).toLocaleString('en-US', {
                          style: 'currency',
                          currency: plan.monthlyPrice.currency,
                        })}/mo`
                      : t`Free`,
                  )
                  .with('yearly', () =>
                    plan.yearlyPrice
                      ? t`${(plan.yearlyPrice.amount / 100).toLocaleString('en-US', {
                          style: 'currency',
                          currency: plan.yearlyPrice.currency,
                        })}/yr`
                      : t`Free`,
                  )
                  .exhaustive()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{plan.description}</p>
            {billingCycle === 'yearly' && plan.yearlyPrice && plan.monthlyPrice && (
              <Badge variant="secondary" className="mt-2 h-5 px-1.5 text-[10px] uppercase">
                <Trans>
                  Save{' '}
                  {Math.round(
                    (1 - plan.yearlyPrice.amount / (plan.monthlyPrice.amount * 12)) * 100,
                  )}
                  %
                </Trans>
              </Badge>
            )}
          </button>
        ))}

        <Link
          to="https://davincisolutions.ai/enterprise-cta"
          target="_blank"
          className="flex items-center space-x-2 rounded-md border bg-muted/30 p-4"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                <Trans>Enterprise</Trans>
              </p>
              <ExternalLinkIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans>Custom solutions for large organisations.</Trans>
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
};
