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
                  className="flex-1"
                  onClick={() => setOpen(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!selectedPriceId}
                  onClick={() =>
                    isIndividualPlan(selectedPriceId) && isPersonalLayoutMode
                      ? null
                      : setStep('create')
                  }
                  asChild={isIndividualPlan(selectedPriceId) && isPersonalLayoutMode}
                >
                  {isIndividualPlan(selectedPriceId) && isPersonalLayoutMode ? (
                    <IndividualPersonalLayoutCheckoutButton priceId={selectedPriceId} />
                  ) : (
                    <Trans>Continue</Trans>
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
                  <Trans>Create an organisation to start collaborating with your team.</Trans>
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
                          <Input {...field} placeholder={t`My Organisation`} />
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => (IS_BILLING_ENABLED() ? setStep('billing') : setOpen(false))}
                  disabled={form.formState.isSubmitting}
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
  const { t } = useLingui();

  const [interval, setInterval] = useState<'monthly' | 'yearly'>('yearly');

  const options = useMemo(() => {
    const plansToRender = [
      {
        id: INTERNAL_CLAIM_ID.FREE,
        title: msg`Free`,
        description: msg`For personal use`,
        price: 0,
        disabled: !canCreateFreeOrganisation,
        badge: !canCreateFreeOrganisation ? msg`Current Plan` : undefined,
      },
      {
        id: INTERNAL_CLAIM_ID.INDIVIDUAL,
        title: msg`Individual`,
        description: msg`For individual professionals`,
        price:
          interval === 'monthly'
            ? plans[INTERNAL_CLAIM_ID.INDIVIDUAL].monthlyPrice?.amount
            : plans[INTERNAL_CLAIM_ID.INDIVIDUAL].yearlyPrice?.amount,
      },
      {
        id: INTERNAL_CLAIM_ID.BUSINESS,
        title: msg`Business`,
        description: msg`For small teams and startups`,
        price:
          interval === 'monthly'
            ? plans[INTERNAL_CLAIM_ID.BUSINESS].monthlyPrice?.amount
            : plans[INTERNAL_CLAIM_ID.BUSINESS].yearlyPrice?.amount,
      },
    ];

    return plansToRender.map((plan) => {
      const priceId =
        interval === 'monthly'
          ? plans[plan.id as keyof InternalClaimPlans]?.monthlyPrice?.id
          : plans[plan.id as keyof InternalClaimPlans]?.yearlyPrice?.id;

      return {
        ...plan,
        priceId: priceId ?? '',
      };
    });
  }, [plans, interval, canCreateFreeOrganisation]);

  return (
    <div className="flex flex-col space-y-4 py-4">
      <Tabs
        value={interval}
        onValueChange={(v) => setInterval(v as 'monthly' | 'yearly')}
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

      <div className="space-y-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={option.disabled}
            onClick={() => onChange(option.priceId)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border p-4 text-left transition-colors',
              value === option.priceId ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{parseMessageDescriptorMacro(t, option.title)}</span>
                {option.badge && (
                  <Badge variant="secondary">{parseMessageDescriptorMacro(t, option.badge)}</Badge>
                )}
              </div>
              <span className="text-sm text-muted-foreground">
                {parseMessageDescriptorMacro(t, option.description)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-lg font-bold">
                {option.price === 0 ? t`Free` : `$${(option.price ?? 0) / 100}`}
              </span>
              {option.price !== 0 && (
                <span className="ml-1 text-sm text-muted-foreground">
                  /{interval === 'monthly' ? t`mo` : t`yr`}
                </span>
              )}
            </div>
          </button>
        ))}

        <Link
          to="https://davincisolutions.ai/enterprise-cta"
          target="_blank"
          className="flex items-center space-x-2 rounded-md border bg-muted/30 p-4"
        >
          <div className="flex-1">
            <div className="font-semibold">
              <Trans>Enterprise</Trans>
            </div>
            <div className="text-sm text-muted-foreground">
              <Trans>For large organisations and custom needs</Trans>
            </div>
          </div>
          <div className="flex items-center text-sm font-medium text-primary">
            <Trans>Contact Us</Trans>
            <ExternalLinkIcon className="ml-1 h-4 w-4" />
          </div>
        </Link>
      </div>
    </div>
  );
};
