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
                  className="w-full"
                  disabled={!selectedPriceId}
                  onClick={() => {
                    if (isIndividualPlan(selectedPriceId)) {
                      return;
                    }

                    setStep('create');
                  }}
                  asChild={isIndividualPlan(selectedPriceId)}
                >
                  {isIndividualPlan(selectedPriceId) ? (
                    <IndividualPersonalLayoutCheckoutButton
                      priceId={selectedPriceId}
                      onSuccess={() => setOpen(false)}
                    />
                  ) : (
                    <Trans>Next</Trans>
                  )}
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
                  <Trans>Create an organisation to manage your documents and team.</Trans>
                </DialogDescription>
              </DialogHeader>

              <Form {...form}>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.stopPropagation();
                    void form.handleSubmit(onFormSubmit)(e);
                  }}
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
                          <Input
                            {...field}
                            autoComplete="off"
                            placeholder={t`My Organisation`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation();
                              }
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
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

                    <Button type="submit" loading={form.formState.isSubmitting}>
                      <Trans>Create organisation</Trans>
                    </Button>
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

type BillingPlanFormProps = {
  value: string;
  onChange: (value: string) => void;
  plans: InternalClaimPlans;
  canCreateFreeOrganisation: boolean;
};

const BillingPlanForm = ({
  value,
  onChange,
  plans,
  canCreateFreeOrganisation,
}: BillingPlanFormProps) => {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');

  const filteredPlans = useMemo(() => {
    return Object.values(plans)
      .filter((plan) => plan.monthlyPrice || plan.yearlyPrice)
      .sort((a, b) => (a.monthlyPrice?.amount ?? 0) - (b.monthlyPrice?.amount ?? 0));
  }, [plans]);

  return (
    <div className="flex flex-col space-y-4">
      <Tabs
        value={interval}
        onValueChange={(value) => setInterval(value as 'monthly' | 'yearly')}
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

      <div className="flex flex-col space-y-2">
        {filteredPlans.map((plan) => {
          const price = interval === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;

          if (!price) {
            return null;
          }

          const isFreePlan = price.amount === 0;

          const isDisabled = isFreePlan && !canCreateFreeOrganisation;

          return (
            <button
              key={plan.id}
              type="button"
              disabled={isDisabled}
              onClick={() => onChange(price.id)}
              className={cn(
                'relative flex flex-col items-start space-y-1 rounded-md border p-4 text-left transition-colors hover:bg-muted/50',
                value === price.id && 'border-primary bg-primary/5 hover:bg-primary/5',
                isDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-semibold">
                  {parseMessageDescriptorMacro(plan.name as unknown as MessageDescriptor)}
                </span>
                <span className="text-sm font-medium">
                  {isFreePlan ? (
                    <Trans>Free</Trans>
                  ) : (
                    <>
                      ${price.amount / 100}
                      <span className="text-muted-foreground">
                        /{interval === 'monthly' ? t`mo` : t`yr`}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {parseMessageDescriptorMacro(plan.description as unknown as MessageDescriptor)}
              </p>
              {isDisabled && (
                <Badge variant="secondary" className="mt-2">
                  <Trans>Limit reached</Trans>
                </Badge>
              )}
            </button>
          );
        })}

        <Link
          to="https://davincisolutions.ai/enterprise-cta"
          target="_blank"
          className="flex items-center space-x-2 rounded-md border bg-muted/30 p-4"
        >
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <span className="font-semibold">
                <Trans>Enterprise</Trans>
              </span>
              <ExternalLinkIcon className="h-3 w-3" />
            </div>
            <p className="text-sm text-muted-foreground">
              <Trans>Custom solutions for your large-scale needs.</Trans>
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
};
