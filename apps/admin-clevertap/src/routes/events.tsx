import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Card, Checkbox, PrimaryButton, Space, Tag, Typography } from '@primathonos/orion';
import { CLEVERTAP_FORWARDABLE_TOPICS } from '@shared/constants/clevertap-events';
import { buildDefaultEventMap, eventMapSchema } from '@shared/schemas/event-map';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { EventMapTable } from '@/components/EventMapTable';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

export const Route = createFileRoute('/events')({ component: EventsPage });

const formSchema = z.object({ events: eventMapSchema, disabledTopics: z.array(z.string()) });
type FormShape = z.infer<typeof formSchema>;

export function EventsPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();

  const form = useForm<FormShape>({
    resolver: zodResolver(formSchema),
    defaultValues: { events: buildDefaultEventMap('clevertap'), disabledTopics: [] },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        events: { ...buildDefaultEventMap('clevertap'), ...(data.events ?? {}) },
        disabledTopics: data.disabledTopics ?? [],
      });
    }
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;
  if (!data) return <Typography.Text>Configure CleverTap credentials first.</Typography.Text>;

  const credentialsReady = data.accountId.trim().length > 0;
  const chargedSource = data.chargedSource ?? 'server';
  const serverEventsEnabled = data.serverEventsEnabled ?? false;
  const serverOwnsCharged = chargedSource === 'server';

  return (
    <FormProvider {...form}>
      <Card
        title="Event mapping"
        extra={
          <Typography.Text type="secondary">
            Rename or disable the 13 pixel events. Disabled ones aren't sent.
          </Typography.Text>
        }
      >
        <form
          onSubmit={form.handleSubmit((values) =>
            update.mutate({
              accountId: data.accountId,
              region: data.region,
              debug: data.debug,
              serverEventsEnabled: data.serverEventsEnabled,
              events: values.events,
              disabledTopics: values.disabledTopics,
            }),
          )}
        >
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            {!credentialsReady && (
              <Alert
                type="warning"
                showIcon
                message="Add your CleverTap Account ID on the Config page before saving the event mapping."
              />
            )}
            <Alert
              type="info"
              showIcon
              message="Purchase defaults to “Charged”"
              description="Charged is CleverTap's reserved purchase event. It drives revenue attribution, RFM scores and post-purchase Journeys. Renaming it turns purchases into a custom event and breaks all three."
            />
            <EventMapTable serverOwnsCharged={serverOwnsCharged} />

            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                Server event topics
              </Typography.Text>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
              >
                Server-forwarded webhook topics (distinct from the client/pixel events above).
                Uncheck one to stop forwarding it to CleverTap, e.g. keep only order events. Order
                Paid is locked to the Charged source on Config.
              </Typography.Text>
              {!serverEventsEnabled && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="Server-side events are off. Turn on Enable server-side events on Config to forward these."
                />
              )}
              <Controller
                control={form.control}
                name="disabledTopics"
                render={({ field }) => {
                  const disabled = new Set(field.value ?? []);
                  return (
                    <Space direction="vertical" size={4}>
                      {CLEVERTAP_FORWARDABLE_TOPICS.map(({ topic, label }) => {
                        const isCharged = topic === 'orders/paid';
                        const checked = isCharged ? serverOwnsCharged : !disabled.has(topic);
                        return (
                          <Checkbox
                            key={topic}
                            checked={checked}
                            disabled={isCharged || !serverEventsEnabled}
                            onChange={(e) => {
                              if (isCharged) return;
                              const next = new Set(disabled);
                              if (e.target.checked) next.delete(topic);
                              else next.add(topic);
                              field.onChange([...next]);
                            }}
                          >
                            {label}
                            {isCharged && (
                              <Tag color="blue" style={{ marginLeft: 8 }}>
                                {serverOwnsCharged ? 'sent server-side' : 'sent client-side'}
                              </Tag>
                            )}
                          </Checkbox>
                        );
                      })}
                    </Space>
                  );
                }}
              />
            </div>

            {update.error && (
              <Alert type="error" message={(update.error as Error).message} showIcon />
            )}
            {update.isSuccess && <Alert type="success" message="Saved." showIcon />}
            <div style={{ textAlign: 'right' }}>
              <PrimaryButton
                htmlType="submit"
                loading={update.isPending}
                disabled={!credentialsReady}
              >
                Save mapping
              </PrimaryButton>
            </div>
          </Space>
        </form>
      </Card>
    </FormProvider>
  );
}
