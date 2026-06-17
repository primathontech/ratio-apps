import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Card, PrimaryButton, Space, Typography } from '@primathonos/orion';
import { buildDefaultEventMap, eventMapSchema } from '@shared/schemas/event-map';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { EventMapTable } from '@/components/EventMapTable';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

export const Route = createFileRoute('/events')({ component: EventsPage });

const formSchema = z.object({ events: eventMapSchema });
type FormShape = z.infer<typeof formSchema>;

function EventsPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();

  const form = useForm<FormShape>({
    resolver: zodResolver(formSchema),
    defaultValues: { events: buildDefaultEventMap() },
  });

  useEffect(() => {
    if (data) form.reset({ events: data.events });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;
  if (!data) return <Typography.Text>Configure MoEngage credentials first.</Typography.Text>;

  const credentialsReady = data.appId.trim().length > 0;

  return (
    <FormProvider {...form}>
      <Card
        title="Event mapping"
        extra={
          <Typography.Text type="secondary">
            Rename or disable any of the 13 events. Disabled events aren't subscribed in the SDK.
          </Typography.Text>
        }
      >
        <form
          onSubmit={form.handleSubmit((values) =>
            update.mutate({ ...data, events: values.events }),
          )}
        >
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            {!credentialsReady && (
              <Alert
                type="warning"
                showIcon
                message="Add your MoEngage App ID on the Config page before saving the event mapping."
              />
            )}
            <EventMapTable />
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
