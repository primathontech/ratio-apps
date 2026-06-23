import { Button, Space, Switch, Table, Typography } from '@primathonos/orion';
import {
  DEFAULT_META_EVENT_MAP as DEFAULT_EVENT_MAP,
  OPEN_STORE_EVENT_NAMES,
  type OpenStoreEventName,
} from '@shared/constants/meta-events';
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
 * 13-row event-map editor. Merchants can only ENABLE/DISABLE each event — the
 * Meta event name is FIXED to the canonical Meta standard name. Renaming is not
 * offered: a renamed standard event breaks SDK firing and makes Meta treat it as
 * a custom event (losing standard-event optimization). The server also normalizes
 * names on save as defense-in-depth.
 */
export function EventMapTable() {
  const { control, setValue } = useFormContext<EventsFormShape>();

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
      title: 'Meta event name',
      dataIndex: 'name',
      // Read-only: the Meta standard event name is fixed (no renaming).
      render: (_v: unknown, record: unknown) => (
        <Typography.Text>{DEFAULT_EVENT_MAP[(record as Row).osName]}</Typography.Text>
      ),
    },
  ];

  const toggleAll = (enabled: boolean) => {
    for (const name of OPEN_STORE_EVENT_NAMES) {
      setValue(`events.${name}.enabled`, enabled, { shouldDirty: true });
    }
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
          scroll={{ x: 480 }}
        />
      </div>
      <Space wrap>
        <Button onClick={() => toggleAll(true)}>Enable all</Button>
        <Button onClick={() => toggleAll(false)}>Disable all</Button>
      </Space>
    </Space>
  );
}
