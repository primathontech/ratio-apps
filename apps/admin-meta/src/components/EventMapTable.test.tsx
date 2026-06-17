import { zodResolver } from '@hookform/resolvers/zod';
import { OrionProvider } from '@primathonos/orion';
import { OPEN_STORE_EVENT_NAMES } from '@shared/constants/openstore-events';
import { buildDefaultEventMap, eventMapSchema } from '@shared/schemas/event-map';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventMapTable } from './EventMapTable';

const schema = z.object({ events: eventMapSchema });

function Harness() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { events: buildDefaultEventMap() },
  });
  return (
    <OrionProvider>
      <FormProvider {...form}>
        <EventMapTable />
      </FormProvider>
    </OrionProvider>
  );
}

describe('EventMapTable', () => {
  it('renders a row for every OpenStore event (13 total)', () => {
    render(<Harness />);
    expect(OPEN_STORE_EVENT_NAMES).toHaveLength(13);
    for (const name of OPEN_STORE_EVENT_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
