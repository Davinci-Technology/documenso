import type { InternalClaimPlans } from '@documenso/ee/server-only/stripe/get-internal-claim-plans';
import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { DOCUMENSO_CLOUD_ENTERPRISE_CTA_URL, IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
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
                  className="w-full"
                  disabled={!selectedPriceId}
                  onClick={() => setStep('create')}
                >
                  <Trans>Continue</Trans>
                </Button>
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
                  <Trans>Enter a name for your new organisation.</Trans>
                </DialogDescription>
              </DialogHeader>

              <Form {...form}>
                <form
                  className="flex flex-col gap-y-4"
                  onSubmit={form.handleSubmit(onFormSubmit)}
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
                          <Input placeholder="Davinci Sign" {...field} />
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter className="gap-2">
                    {IS_BILLING_ENABLED() && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStep('billing')}
                        disabled={form.formState.isSubmitting}
                      >
                        <Trans>Back</Trans>
                      </Button>
                    )}

                    {!isIndividualPlan(selectedPriceId) || !isPersonalLayoutMode ? (
                      <Button type="submit" loading={form.formState.isSubmitting}>
                        <Trans>Create organisation</Trans>
                      </Button>
                    ) : (
                      <IndividualPersonalLayoutCheckoutButton
                        priceId={selectedPriceId}
                        onCheckoutStarted={() => setOpen(false)}
                      />
                    )}
                  </DialogFooter>
                </form>
              </Form>
            </>
          ))
          .exhaustive()}
      </DialogContent>
    </Dialog>
  );
};

interface BillingPlanFormProps {
  value: string;
  onChange: (value: string) => void;
  plans: InternalClaimPlans;
  canCreateFreeOrganisation?: boolean;
}

const BillingPlanForm = ({
  value,
  onChange,
  plans,
  canCreateFreeOrganisation,
}: BillingPlanFormProps) => {
  const { t } = useLingui();

  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');

  const options = useMemo(() => {
    return Object.values(plans)
      .map((plan) => {
        const price = interval === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;

        if (!price) {
          return null;
        }

        return {
          id: plan.id,
          priceId: price.id,
          name: parseMessageDescriptorMacro(t, plan.name as unknown as MessageDescriptor),
          price: (price.amount / 100).toLocaleString('en-US', {
            style: 'currency',
            currency: price.currency,
          }),
          period: interval === 'monthly' ? t`per month` : t`per year`,
          disabled: plan.id === INTERNAL_CLAIM_ID.FREE && !canCreateFreeOrganisation,
        };
      })
      .filter((option) => option !== null);
  }, [plans, interval, t, canCreateFreeOrganisation]);

  return (
    <div className="flex flex-col gap-y-4">
      <Tabs
        value={interval}
        onValueChange={(value) => setInterval(value as 'monthly' | 'yearly')}
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
        {options.map((option) => (
          <button
            key={option.priceId}
            type="button"
            disabled={option.disabled}
            className={cn(
              'flex flex-col gap-y-1 rounded-md border p-4 text-left transition-colors',
              value === option.priceId
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted/50',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => onChange(option.priceId)}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{option.name}</span>
              {option.id === INTERNAL_CLAIM_ID.FREE && (
                <Badge variant="secondary">
                  <Trans>Free</Trans>
                </Badge>
              )}
            </div>
            <div className="flex items-baseline gap-x-1">
              <span className="text-2xl font-bold">{option.price}</span>
              <span className="text-sm text-muted-foreground">{option.period}</span>
            </div>
          </button>
        ))}

        <Link
          to={DOCUMENSO_CLOUD_ENTERPRISE_CTA_URL}
          target="_blank"
          className="flex items-center space-x-2 rounded-md border bg-muted/30 p-4"
        >
          <div className="flex-1">
            <p className="font-semibold">
              <Trans>Enterprise</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>Custom solutions for your organisation.</Trans>
            </p>
          </div>
          <ExternalLinkIcon className="h-5 w-5 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
};
