import { Button, Input, Space, Switch, Table, Typography } from '@primathonos/orion';
import { DEFAULT_MOENGAGE_EVENT_MAP as DEFAULT_EVENT_MAP } from '@shared/constants/moengage-events';
import {
  OPEN_STORE_EVENT_NAMES,
  type OpenStoreEventName,
} from '@shared/constants/openstore-events';
import type { EventMap } from '@shared/schemas/event-map';
import { Controller, useFormContext } from 'react-hook-form';

interface EventsFormShape {
  events: EventMap;
}

interface Row {
  key: OpenStoreEventName;
  osName: OpenStoreEventName;
}

/**
 * 13-row event-map editor. RHF Controller per cell (enabled toggle + name input),
 * validation handled by the parent's Zod resolver against `eventMapSchema`.
 */
export function EventMapTable() {
  const { control, setValue, getValues } = useFormContext<EventsFormShape>();

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
              <Switch checked={field.value} onChange={(v) => field.onChange(v)} />
            )}
          />
        );
      },
    },
    {
      key: 'osName',
      title: 'OpenStore event',
      dataIndex: 'osName',
      render: (osName: unknown) => (
        <Typography.Text code>{osName as OpenStoreEventName}</Typography.Text>
      ),
    },
    {
      key: 'name',
      title: 'MoEngage event name',
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
      <Space wrap>
        <Button onClick={resetAll}>Reset all to defaults</Button>
        <Button onClick={() => toggleAll(true)}>Enable all</Button>
        <Button onClick={() => toggleAll(false)}>Disable all</Button>
      </Space>
    </Space>
  );
}
