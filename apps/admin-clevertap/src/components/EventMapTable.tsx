import { Button, Input, Space, Switch, Table, Tag, Typography } from '@primathonos/orion';
import {
  DEFAULT_CLEVERTAP_EVENT_MAP as DEFAULT_EVENT_MAP,
  OPEN_STORE_EVENT_NAMES,
  type OpenStoreEventName,
} from '@shared/constants/clevertap-events';
import type { EventMap } from '@shared/schemas/event-map';
import { Controller, useFormContext } from 'react-hook-form';

interface EventsFormShape {
  events: EventMap;
}

interface Row {
  key: OpenStoreEventName;
  osName: OpenStoreEventName;
}

export function EventMapTable({ serverOwnsCharged = false }: { serverOwnsCharged?: boolean }) {
  const { control, setValue, getValues } = useFormContext<EventsFormShape>();

  const isServerOwned = (osName: OpenStoreEventName) => serverOwnsCharged && osName === 'Purchase';

  const dataSource: Row[] = OPEN_STORE_EVENT_NAMES.map((osName) => ({ key: osName, osName }));

  const columns = [
    {
      key: 'enabled',
      title: 'Send',
      dataIndex: 'enabled',
      width: 90,
      render: (_v: unknown, record: unknown) => {
        const { osName } = record as Row;
        return (
          <Controller
            control={control}
            name={`events.${osName}.enabled` as const}
            render={({ field }) => (
              <Switch
                checked={field.value}
                disabled={isServerOwned(osName)}
                onChange={(v) => field.onChange(v)}
              />
            )}
          />
        );
      },
    },
    {
      key: 'osName',
      title: 'OpenStore event',
      dataIndex: 'osName',
      render: (osName: unknown) => {
        const name = osName as OpenStoreEventName;
        return (
          <Space>
            <Typography.Text code>{name}</Typography.Text>
            {isServerOwned(name) && <Tag color="blue">sent server-side</Tag>}
          </Space>
        );
      },
    },
    {
      key: 'name',
      title: 'CleverTap event name',
      dataIndex: 'name',
      render: (_v: unknown, record: unknown) => {
        const { osName } = record as Row;
        return (
          <Controller
            control={control}
            name={`events.${osName}.name` as const}
            render={({ field, fieldState }) => (
              <>
                <Input
                  {...field}
                  placeholder={DEFAULT_EVENT_MAP[osName]}
                  {...(fieldState.invalid ? { status: 'error' as const } : {})}
                />
                {fieldState.error && (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    {fieldState.error.message}
                  </Typography.Text>
                )}
              </>
            )}
          />
        );
      },
    },
    {
      key: 'reset',
      title: '',
      dataIndex: 'reset',
      width: 80,
      render: (_v: unknown, record: unknown) => {
        const { osName } = record as Row;
        return (
          <Button type="link" size="small" onClick={() => resetRow(osName)}>
            reset
          </Button>
        );
      },
    },
  ];

  const resetRow = (name: OpenStoreEventName) => {
    setValue(`events.${name}.enabled`, true, { shouldDirty: true });
    setValue(`events.${name}.name`, DEFAULT_EVENT_MAP[name], { shouldDirty: true });
  };

  const toggleAll = (enabled: boolean) => {
    const current = getValues('events');
    for (const name of OPEN_STORE_EVENT_NAMES) {
      setValue(`events.${name}.enabled`, enabled, { shouldDirty: true });
      if (enabled && !current[name]?.name) {
        setValue(`events.${name}.name`, DEFAULT_EVENT_MAP[name], { shouldDirty: true });
      }
    }
  };

  const resetAll = () => {
    for (const name of OPEN_STORE_EVENT_NAMES) resetRow(name);
  };

  return (
    <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
      <div className="event-map-table">
        <Table
          rowKey="key"
          dataSource={dataSource}
          columns={columns}
          pagination={false}
          size="small"
          bordered
          scroll={{ x: 560 }}
        />
      </div>
      {serverOwnsCharged && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Purchase is off here because Charged is set to Server-side on the Config page (so it isn't
          sent twice). Switch that to Client-side on Config to send Charged from the pixel.
        </Typography.Text>
      )}
      <Space wrap>
        <Button onClick={resetAll}>Reset all to defaults</Button>
        <Button onClick={() => toggleAll(true)}>Enable all</Button>
        <Button onClick={() => toggleAll(false)}>Disable all</Button>
      </Space>
    </Space>
  );
}
