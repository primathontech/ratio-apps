import { zodResolver } from '@hookform/resolvers/zod';
import { OrionProvider, PrimaryButton } from '@primathonos/orion';
import {
  CLEVERTAP_CHARGED_EVENT,
  DEFAULT_CLEVERTAP_EVENT_MAP,
} from '@shared/constants/clevertap-events';
import {
  OPEN_STORE_EVENT_NAMES,
  type OpenStoreEventName,
} from '@shared/constants/openstore-events';
import {
  buildDefaultEventMap,
  buildSdkEventNameMap,
  type EventMap,
  eventMapSchema,
} from '@shared/schemas/event-map';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EventMapTable } from './EventMapTable';

const schema = z.object({ events: eventMapSchema });
type FormShape = z.infer<typeof schema>;

function Harness({ onValid }: { onValid?: (events: EventMap) => void }) {
  const form = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: { events: buildDefaultEventMap('clevertap') },
  });
  return (
    <OrionProvider>
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit((values) => onValid?.(values.events))}>
          <EventMapTable />
          <PrimaryButton htmlType="submit">Save mapping</PrimaryButton>
          <span data-testid="dirty">{form.formState.isDirty ? 'dirty' : 'clean'}</span>
        </form>
      </FormProvider>
    </OrionProvider>
  );
}

function nameInput(osName: OpenStoreEventName): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[name="events.${osName}.name"]`);
  if (!el) throw new Error(`no name input rendered for ${osName}`);
  return el;
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Save mapping' }));
}

describe('EventMapTable', () => {
  it('renders a row for every OpenStore event (13 total) with its default CleverTap name', () => {
    render(<Harness />);
    expect(OPEN_STORE_EVENT_NAMES).toHaveLength(13);
    for (const osName of OPEN_STORE_EVENT_NAMES) {
      expect(screen.getByText(osName)).toBeInTheDocument();
      expect(nameInput(osName).value).toBe(DEFAULT_CLEVERTAP_EVENT_MAP[osName]);
    }
  });

  it('defaults Purchase to CleverTap’s reserved Charged event', () => {
    render(<Harness />);
    expect(nameInput('Purchase').value).toBe(CLEVERTAP_CHARGED_EVENT);
    expect(CLEVERTAP_CHARGED_EVENT).toBe('Charged');
  });

  it('renaming an event marks the form dirty and submits the new map', async () => {
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);

    expect(screen.getByTestId('dirty').textContent).toBe('clean');
    fireEvent.change(nameInput('AddToCart'), { target: { value: 'Cart Add' } });
    await waitFor(() => expect(screen.getByTestId('dirty').textContent).toBe('dirty'));

    submit();
    await waitFor(() => expect(onValid).toHaveBeenCalled());
    const events = onValid.mock.calls[0]?.[0] as EventMap;
    expect(events.AddToCart).toEqual({ enabled: true, name: 'Cart Add' });
    expect(events.PageView.name).toBe(DEFAULT_CLEVERTAP_EVENT_MAP.PageView);
  });

  it('disabling an event drops it from the map the SDK subscribes to', async () => {
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);

    const index = OPEN_STORE_EVENT_NAMES.indexOf('Search');
    fireEvent.click(screen.getAllByRole('switch')[index] as HTMLElement);
    submit();

    await waitFor(() => expect(onValid).toHaveBeenCalled());
    const events = onValid.mock.calls[0]?.[0] as EventMap;
    expect(events.Search.enabled).toBe(false);
    const sdkMap = buildSdkEventNameMap(events);
    expect('Search' in sdkMap).toBe(false);
    expect(sdkMap.Purchase).toBe(CLEVERTAP_CHARGED_EVENT);
  });

  it('rejects a blank event name instead of submitting it', async () => {
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);

    fireEvent.change(nameInput('PageView'), { target: { value: '' } });
    submit();

    expect(await screen.findByText(/must not be empty/i)).toBeInTheDocument();
    expect(onValid).not.toHaveBeenCalled();
  });

  it('resets a single row back to its CleverTap default', async () => {
    render(<Harness />);
    fireEvent.change(nameInput('Purchase'), { target: { value: 'Purchased' } });
    expect(nameInput('Purchase').value).toBe('Purchased');

    const purchaseRow = nameInput('Purchase').closest('tr');
    const resetButton = Array.from(purchaseRow?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === 'reset',
    );
    if (!resetButton) throw new Error('no reset button in the Purchase row');
    fireEvent.click(resetButton);

    await waitFor(() => expect(nameInput('Purchase').value).toBe(CLEVERTAP_CHARGED_EVENT));
  });
});
