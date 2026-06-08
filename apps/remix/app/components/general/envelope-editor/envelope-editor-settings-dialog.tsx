import { useEffect, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { Trans } from '@lingui/react/macro';
import {
  DocumentDistributionMethod,
  DocumentVisibility,
  EnvelopeType,
  RecipientRole,
  SendStatus,
  TemplateType,
} from '@prisma/client';
import type * as DialogPrimitive from '@radix-ui/react-dialog';
import { BellRingIcon, InfoIcon, MailIcon, SettingsIcon, ShieldIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { useCurrentEnvelopeEditor } from '@documenso/lib/client-only/providers/envelope-editor-provider';
import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
import { DATE_FORMATS, DEFAULT_DOCUMENT_DATE_FORMAT } from '@documenso/lib/constants/date-formats';
import {
  DOCUMENT_DISTRIBUTION_METHODS,
  DOCUMENT_SIGNATURE_TYPES,
} from '@documenso/lib/constants/document';
import { ZEnvelopeExpirationPeriod } from '@documenso/lib/constants/envelope-expiration';
import { ZEnvelopeReminderSettings } from '@documenso/lib/constants/envelope-reminder';
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  isValidLanguageCode,
} from '@documenso/lib/constants/i18n';
import { DEFAULT_DOCUMENT_TIME_ZONE, TIME_ZONES } from '@documenso/lib/constants/time-zones';
import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { AppError } from '@documenso/lib/errors/app-error';
import {
  ZDocumentAccessAuthTypesSchema,
  ZDocumentActionAuthTypesSchema,
} from '@documenso/lib/types/document-auth';
import { DocumentEmailEvents, ZDocumentEmailSettingsSchema } from '@documenso/lib/types/document-email';
import {
  type TDocumentMetaDateFormat,
  ZDocumentMetaDateFormatSchema,
  ZDocumentMetaTimezoneSchema,
} from '@documenso/lib/types/document-meta';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import { isValidRedirectUrl } from '@documenso/lib/utils/is-valid-redirect-url';
import {
  DocumentSignatureType,
  canAccessTeamDocument,
  extractTeamSignatureSettings,
} from '@documenso/lib/utils/teams';
import { zEmail } from '@documenso/lib/utils/zod';
import { trpc } from '@documenso/trpc/react';
import { DocumentEmailCheckboxes } from '@documenso/ui/components/document/document-email-checkboxes';
import {
  DocumentGlobalAuthAccessSelect,
  DocumentGlobalAuthAccessTooltip,
} from '@documenso/ui/components/document/document-global-auth-access-select';
import {
  DocumentGlobalAuthActionSelect,
  DocumentGlobalAuthActionTooltip,
} from '@documenso/ui/components/document/document-global-auth-action-select';
import { DocumentSendEmailMessageHelper } from '@documenso/ui/components/document/document-send-email-message-helper';
import { DocumentSignatureSettingsTooltip } from '@documenso/ui/components/document/document-signature-settings-tooltip';
import {
  DocumentVisibilitySelect,
  DocumentVisibilityTooltip,
} from '@documenso/ui/components/document/document-visibility-select';
import { ExpirationPeriodPicker } from '@documenso/ui/components/document/expiration-period-picker';
import { ReminderSettingsPicker } from '@documenso/ui/components/document/reminder-settings-picker';
import {
  TemplateTypeSelect,
  TemplateTypeTooltip,
} from '@documenso/ui/components/template/template-type-select';
import { cn } from '@documenso/ui/lib/utils';
import { Alert, AlertDescription } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import { CardDescription, CardHeader, CardTitle } from '@documenso/ui/primitives/card';
import { Combobox } from '@documenso/ui/primitives/combobox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { MultiSelectCombobox } from '@documenso/ui/primitives/multi-select-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@documenso/ui/primitives/select';
import { Textarea } from '@documenso/ui/primitives/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@documenso/ui/primitives/tooltip';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useCurrentTeam } from '~/providers/team';

export const ZAddSettingsFormSchema = z.object({
  templateType: z.nativeEnum(TemplateType).optional(),
  externalId: z.string().optional(),
  visibility: z.nativeEnum(DocumentVisibility).optional(),
  globalAccessAuth: z
    .array(z.union([ZDocumentAccessAuthTypesSchema, z.literal('-1')]))
    .transform((val) => (val.length === 1 && val[0] === '-1' ? [] : val))
    .optional()
    .default([]),
  globalActionAuth: z.array(ZDocumentActionAuthTypesSchema).optional().default([]),
  meta: z.object({
    subject: z.string(),
    message: z.string(),
    timezone: ZDocumentMetaTimezoneSchema.default(DEFAULT_DOCUMENT_TIME_ZONE),
    dateFormat: ZDocumentMetaDateFormatSchema.default(DEFAULT_DOCUMENT_DATE_FORMAT),
    distributionMethod: z
      .nativeEnum(DocumentDistributionMethod)
      .optional()
      .default(DocumentDistributionMethod.EMAIL),
    redirectUrl: z
      .string()
      .optional()
      .refine((value) => value === undefined || value === '' || isValidRedirectUrl(value), {
        message:
          'Please enter a valid URL, make sure you include http:// or https:// part of the url.',
      }),
    language: z
      .union([z.string(), z.enum(SUPPORTED_LANGUAGE_CODES)])
      .optional()
      .default('en'),
    emailId: z.string().nullable(),
    emailReplyTo: z.preprocess((val) => (val === '' ? undefined : val), zEmail().optional()),
    emailSettings: ZDocumentEmailSettingsSchema,
    signatureTypes: z.array(z.nativeEnum(DocumentSignatureType)).min(1, {
      message: 'At least one signature type must be enabled.',
    }),
    envelopeExpirationPeriod: ZEnvelopeExpirationPeriod.nullable(),
    reminderSettings: ZEnvelopeReminderSettings.nullable(),
  }),
});

type EnvelopeEditorSettingsTabType = 'general' | 'reminders' | 'notifications' | 'security';

const tabs = [
  {
    id: 'general',
    title: msg`General`,
    icon: SettingsIcon,
    description: msg`Configure document settings and options before sending.`,
  },
  {
    id: 'reminders',
    title: msg`Reminders`,
    icon: BellRingIcon,
    description: msg`Configure signing reminder settings for the document.`,
  },
  {
    id: 'notifications',
    title: msg`Notifications`,
    icon: MailIcon,
    description: msg`Configure notification settings for the document.`,
  },
  {
    id: 'security',
    title: msg`Security`,
    icon: ShieldIcon,
    description: msg`Configure security settings for the document.`,
  },
] as const;

// Recipient-facing notification events. These are suppressed at send time
// when distributionMethod is not EMAIL (see extractDerivedDocumentEmailSettings),
// so the UI mirrors that by disabling the matching checkboxes.
const RECIPIENT_EMAIL_EVENTS = [
  DocumentEmailEvents.RecipientSigningRequest,
  DocumentEmailEvents.RecipientRemoved,
  DocumentEmailEvents.RecipientSigned,
  DocumentEmailEvents.DocumentPending,
  DocumentEmailEvents.DocumentCompleted,
  DocumentEmailEvents.DocumentDeleted,
] as const;

export type TAddSettingsFormSchema = z.infer<typeof ZAddSettingsFormSchema>;

type EnvelopeEditorSettingsDialogProps = {
  trigger?: React.ReactNode;
} & Omit<DialogPrimitive.DialogProps, 'children'>;

export const EnvelopeEditorSettingsDialog = ({
  trigger,
  ...props
}: EnvelopeEditorSettingsDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const {
    envelope,
    updateEnvelopeAsync,
    editorConfig,
    isEmbedded,
    organisationEmails,
  } = useCurrentEnvelopeEditor();

  const { settings } = editorConfig;

  const team = useCurrentTeam();
  const organisation = useCurrentOrganisation();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<EnvelopeEditorSettingsTabType>('general');

  const { documentAuthOption } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
  });

  const createDefaultValues = () => {
    return {
      templateType: envelope.templateType || TemplateType.PRIVATE,
      externalId: envelope.externalId || '',
      visibility: envelope.visibility || '',
      globalAccessAuth: documentAuthOption?.globalAccessAuth || [],
      globalActionAuth: documentAuthOption?.globalActionAuth || [],
      meta: {
        subject: envelope.documentMeta.subject ?? '',
        message: envelope.documentMeta.message ?? '',
        timezone: envelope.documentMeta.timezone ?? DEFAULT_DOCUMENT_TIME_ZONE,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        dateFormat: (envelope.documentMeta.dateFormat ??
          DEFAULT_DOCUMENT_DATE_FORMAT) as TDocumentMetaDateFormat,
        distributionMethod:
          envelope.documentMeta.distributionMethod || DocumentDistributionMethod.EMAIL,
        redirectUrl: envelope.documentMeta.redirectUrl ?? '',
        language: envelope.documentMeta.language ?? 'en',
        emailId: envelope.documentMeta.emailId ?? null,
        emailReplyTo: envelope.documentMeta.emailReplyTo ?? undefined,
        emailSettings: ZDocumentEmailSettingsSchema.parse(envelope.documentMeta.emailSettings),
        signatureTypes: extractTeamSignatureSettings(envelope.documentMeta),
        envelopeExpirationPeriod: envelope.documentMeta?.envelopeExpirationPeriod ?? null,
        reminderSettings: envelope.documentMeta?.reminderSettings ?? null,
      },
    };
  };

  const form = useForm<TAddSettingsFormSchema>({
    resolver: zodResolver(ZAddSettingsFormSchema),
    defaultValues: createDefaultValues(),
  });

  const emailSettings = form.watch('meta.emailSettings');
  const distributionMethod = form.watch('meta.distributionMethod');
  const isEmailDistribution = distributionMethod === DocumentDistributionMethod.EMAIL;

  const { data: emails = [], isLoading: isLoadingEmails } = trpc.team.getTeamEmails.useQuery(
    {
      teamId: team?.id ?? '',
    },
    {
      enabled:
        !!team &&
        organisation.organisationClaim.flags.emailDomains &&
        settings.allowConfigureEmailSender,
      trpc: {
        context: DO_NOT_INVALIDATE_QUERY_ON_MUTATION,
      },
    },
  );

  useEffect(() => {
    if (open) {
      form.reset(createDefaultValues());
      setActiveTab('general');
    }
  }, [open]);

  const onFormSubmit = async (values: TAddSettingsFormSchema) => {
    try {
      await updateEnvelopeAsync({
        templateType: values.templateType,
        externalId: values.externalId,
        visibility: values.visibility,
        documentMeta: values.meta,
        envelopeExpirationPeriod: values.meta.envelopeExpirationPeriod,
        reminderSettings: values.meta.reminderSettings,
        globalAccessAuth: values.globalAccessAuth,
        globalActionAuth: values.globalActionAuth,
      });

      toast({
        title: t(msg`Settings updated`),
        description: t(msg`Current document settings have been updated.`),
      });

      setOpen(false);
    } catch (e) {
      const message = e instanceof AppError ? e.message : t(msg`Something went wrong`);

      toast({
        title: t(msg`Error`),
        description: message,
        variant: 'destructive',
      });
    }
  };

  const selectedTab = tabs.find((tab) => tab.id === activeTab);

  return (
    <Dialog open={open} onOpenChange={setOpen} {...props}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="max-w-4xl p-0">
        <div className="grid grid-cols-12 gap-y-4">
          <DialogHeader className="col-span-12 px-6 py-6 md:col-span-9 md:col-start-4">
            <DialogTitle>
              <Trans>Settings</Trans>
            </DialogTitle>
          </DialogHeader>

          <nav className="col-span-12 mb-8 flex flex-wrap items-center justify-start gap-x-2 gap-y-4 px-4 md:col-span-3 md:w-full md:flex-col md:items-start md:gap-y-2">
            {tabs.map((tab) => {
              if (tab.id === 'notifications' && !settings.allowConfigureDistribution) {
                return null;
              }

              if (tab.id === 'reminders' && !settings.allowConfigureReminders) {
                return null;
              }

              return (
                <Button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  variant="ghost"
                  className={cn('w-full justify-start', {
                    'bg-secondary': activeTab === tab.id,
                  })}
                >
                  <tab.icon className="mr-2 h-5 w-5" />
                  {t(tab.title)}
                </Button>
              );
            })}
          </nav>
        </div>

        {/* Content. */}
        <div className="flex w-full flex-col">
          <CardHeader className="border-b pb-4">
            <CardTitle>{selectedTab ? t(selectedTab.title) : ''}</CardTitle>
            <CardDescription>{selectedTab ? t(selectedTab.description) : ''}</CardDescription>
          </CardHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onFormSubmit)}>
              <fieldset
                className="flex h-[45rem] max-h-[calc(100vh-14rem)] w-full flex-col space-y-6 overflow-y-auto px-6 py-6"
                disabled={form.formState.isSubmitting}
                key={activeTab}
              >
                {match({ activeTab, settings })
                  .with({ activeTab: 'general' }, () => (
                    <>
                      {settings.allowConfigureLanguage && (
                        <FormField
                          control={form.control}
                          name="meta.language"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="inline-flex items-center">
                                <Trans>Language</Trans>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <InfoIcon className="mx-2 h-4 w-4" />
                                  </TooltipTrigger>

                                  <TooltipContent className="max-w-md space-y-2 p-4 text-foreground">
                                    <Trans>
                                      Controls the language for the document, including the language to be used for
                                      email notifications, and the final certificate that is generated and attached to
                                      the document.
                                    </Trans>
                                  </TooltipContent>
                                </Tooltip>
                              </FormLabel>

                              <FormControl>
                                <Select
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                >
                                  <SelectTrigger className="bg-background">
                                    <SelectValue />
                                  </SelectTrigger>

                                  <SelectContent>
                                    {Object.entries(SUPPORTED_LANGUAGES).map(([code, language]) => (
                                      <SelectItem key={code} value={code}>
                                        {t(language.full)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {settings.allowConfigureDistribution && (
                        <FormField
                          control={form.control}
                          name="meta.distributionMethod"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                <Trans>Distribution Method</Trans>
                              </FormLabel>

                              <FormControl>
                                <Select
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                >
                                  <SelectTrigger className="bg-background">
                                    <SelectValue />
                                  </SelectTrigger>

                                  <SelectContent>
                                    {DOCUMENT_DISTRIBUTION_METHODS.map((method) => (
                                      <SelectItem key={method} value={method}>
                                        {method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>

                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {settings.allowConfigureVisibility && (
                        <FormField
                          control={form.control}
                          name="visibility"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex flex-row items-center">
                                <Trans>Document Visibility</Trans>
                                <DocumentVisibilityTooltip />
                              </FormLabel>

                              <FormControl>
                                <DocumentVisibilitySelect
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}

                      {settings.allowConfigureTemplateType && (
                        <FormField
                          control={form.control}
                          name="templateType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex flex-row items-center">
                                <Trans>Template Type</Trans>
                                <TemplateTypeTooltip />
                              </FormLabel>

                              <FormControl>
                                <TemplateTypeSelect
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="meta.timezone"
                          render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel>
                                <Trans>Time Zone</Trans>
                              </FormLabel>

                              <Combobox
                                className="bg-background"
                                options={TIME_ZONES.map((timezone) => ({
                                  label: timezone,
                                  value: timezone,
                                }))}
                                {...field}
                                value={field.value ?? DEFAULT_DOCUMENT_TIME_ZONE}
                                disabled={field.disabled}
                                onSelect={field.onChange}
                              />

                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="meta.dateFormat"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                <Trans>Date Format</Trans>
                              </FormLabel>

                              <FormControl>
                                <Select
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                >
                                  <SelectTrigger className="bg-background">
                                    <SelectValue />
                                  </SelectTrigger>

                                  <SelectContent>
                                    {DATE_FORMATS.map((format) => (
                                      <SelectItem key={format} value={format}>
                                        {format}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>

                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="meta.signatureTypes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex flex-row items-center gap-x-2">
                              <Trans>Signature settings</Trans>
                              <DocumentSignatureSettingsTooltip />
                            </FormLabel>

                            <FormControl>
                              <MultiSelectCombobox
                                disabled={field.disabled}
                                options={DOCUMENT_SIGNATURE_TYPES.map((type) => ({
                                  label: t(type.label),
                                  value: type.value,
                                }))}
                                selectedValues={field.value}
                                onSelectedValuesChange={field.onChange}
                              />
                            </FormControl>

                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="meta.redirectUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans>
                                Redirect URL <span className="text-muted-foreground">(Optional)</span>
                              </Trans>
                            </FormLabel>

                            <FormControl>
                              <Input
                                placeholder="https://example.com"
                                {...field}
                                value={field.value ?? ''}
                              />
                            </FormControl>

                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  ))
                  .with({ activeTab: 'reminders', settings: { allowConfigureReminders: true } }, () => (
                    <>
                      <FormField
                        control={form.control}
                        name="meta.envelopeExpirationPeriod"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans>Envelope expiration</Trans>
                            </FormLabel>

                            <FormControl>
                              <ExpirationPeriodPicker
                                value={field.value}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="meta.reminderSettings"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans>Signing Reminders</Trans>
                            </FormLabel>

                            <FormControl>
                              <ReminderSettingsPicker
                                value={field.value}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  ))
                  .with({ activeTab: 'notifications', settings: { allowConfigureDistribution: true } }, () => (
                    <>
                      {settings.allowConfigureEmailSender && organisation.organisationClaim.flags.emailDomains && (
                        <FormField
                          control={form.control}
                          name="meta.emailId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                <Trans>Email Sender</Trans>
                              </FormLabel>

                              <FormControl>
                                <Select
                                  {...field}
                                  value={field.value === null ? '-1' : field.value}
                                  onValueChange={(value) => field.onChange(value === '-1' ? null : value)}
                                  disabled={!isEmailDistribution}
                                >
                                  <SelectTrigger loading={isLoadingEmails} className="bg-background">
                                    <SelectValue />
                                  </SelectTrigger>

                                  <SelectContent>
                                    {emails.map((email) => (
                                      <SelectItem key={email.id} value={email.id}>
                                        {email.email}
                                      </SelectItem>
                                    ))}

                                    <SelectItem value={'-1'}>Davinci Sign</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>

                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {settings.allowConfigureEmailReplyTo && (
                        <FormField
                          control={form.control}
                          name="meta.emailReplyTo"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                <Trans>
                                  Reply To Email <span className="text-muted-foreground">(Optional)</span>
                                </Trans>
                              </FormLabel>

                              <FormControl>
                                <Input {...field} disabled={!isEmailDistribution} />
                              </FormControl>

                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={form.control}
                        name="meta.subject"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans>
                                Subject <span className="text-muted-foreground">(Optional)</span>
                              </Trans>
                            </FormLabel>

                            <FormControl>
                              <Input {...field} disabled={!isEmailDistribution} />
                            </FormControl>

                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="meta.message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex flex-row items-center">
                              <Trans>
                                Message <span className="text-muted-foreground">(Optional)</span>
                              </Trans>
                              <Tooltip>
                                <TooltipTrigger>
                                  <InfoIcon className="mx-2 h-4 w-4" />
                                </TooltipTrigger>
                                <TooltipContent className="p-4 text-muted-foreground">
                                  <DocumentSendEmailMessageHelper />
                                </TooltipContent>
                              </Tooltip>
                            </FormLabel>

                            <FormControl>
                              <Textarea
                                className="h-16 resize-none bg-background"
                                {...field}
                                disabled={!isEmailDistribution}
                              />
                            </FormControl>

                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <DocumentEmailCheckboxes
                        value={emailSettings}
                        onChange={(value) => form.setValue('meta.emailSettings', value)}
                        hiddenEvents={isEmailDistribution ? undefined : RECIPIENT_EMAIL_EVENTS}
                      />

                      {!isEmailDistribution && (
                        <Alert variant="warning">
                          <AlertDescription>
                            <Trans>
                              Email distribution needs to be enabled in the general settings tab to configure recipient
                              email related settings.
                            </Trans>
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  ))
                  .with({ activeTab: 'security' }, () => (
                    <>
                      {organisation.organisationClaim.flags.cfr21 && (
                        <FormField
                          control={form.control}
                          name="globalActionAuth"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex flex-row items-center">
                                <Trans>Recipient action authentication</Trans>
                                <DocumentGlobalAuthActionTooltip />
                              </FormLabel>

                              <FormControl>
                                <DocumentGlobalAuthActionSelect
                                  value={field.value}
                                  disabled={field.disabled}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={form.control}
                        name="globalAccessAuth"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex flex-row items-center">
                              <Trans>Document access</Trans>
                              <DocumentGlobalAuthAccessTooltip />
                            </FormLabel>

                            <FormControl>
                              <DocumentGlobalAuthAccessSelect
                                value={field.value}
                                disabled={field.disabled}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  ))
                  .otherwise(() => null)}
              </fieldset>

              <div className="flex border-t px-6 py-4">
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    <Trans>Cancel</Trans>
                  </Button>
                </DialogClose>

                <Button
                  className="ml-auto min-w-[5rem]"
                  type="submit"
                  loading={form.formState.isSubmitting}
                >
                  <Trans>Save</Trans>
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
