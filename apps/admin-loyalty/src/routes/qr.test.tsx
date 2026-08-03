import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { maskPhone, QrPage, validate } from './qr';

vi.mock('@/lib/api');
vi.mock('@/lib/download', () => ({ downloadAuthenticated: vi.fn() }));

const mockedApi = vi.mocked(api);

const qr = {
  id: 'q1',
  code: 'ABC123',
  eventName: 'Diwali Expo',
  pointsPerScan: 100,
  maxScans: 0,
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-12-31T00:00:00.000Z',
  claimMessage: null,
  status: 'ACTIVE',
  scanCount: 5,
  newPhoneCount: 2,
  state: 'active',
};

const detail = {
  ...qr,
  claimUrl: 'https://wellversed.in/?loyalty_qr=ABC123',
  loaderSnippet:
    '<script src="https://api.example.com/loyalty/sdk/loyalty-loader.js?store=m1"></script>',
};

function routeApi(list: unknown[] = [qr]) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path === '/api/qr-codes') return Promise.resolve(list);
    if (method === 'GET' && /\/api\/qr-codes\/q1\/scans/.test(path)) {
      return Promise.resolve({
        rows: [
          {
            id: 1,
            qrCodeId: 'q1',
            phone: '9876543210',
            isNewPhone: true,
            coreTransactionId: null,
            convertedOrderId: null,
            convertedAt: null,
            scannedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    }
    if (method === 'GET' && /\/api\/qr-codes\/q1$/.test(path)) return Promise.resolve(detail);
    if (method === 'POST' && path === '/api/qr-codes')
      return Promise.resolve({ ...qr, claimUrl: detail.claimUrl });
    if (method === 'POST' && /\/status$/.test(path))
      return Promise.resolve({ ...qr, status: 'PAUSED' });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('maskPhone', () => {
  it('masks all but the last four digits', () => {
    expect(maskPhone('9876543210')).toBe('******3210');
    expect(maskPhone('123')).toBe('123');
  });
});

describe('QrPage', () => {
  it('blocks create when required fields are invalid', async () => {
    routeApi([]);
    renderWithProviders(<QrPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New QR code' }));
    // eventName is empty; max scans set negative.
    fireEvent.change(screen.getByLabelText('Max scans'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create QR code' }));

    await waitFor(() => expect(screen.getByText('Event name is required.')).toBeInTheDocument());
    expect(screen.getByText('Max scans must be 0 (unlimited) or more.')).toBeInTheDocument();
    // No POST fired while invalid.
    expect(
      mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/qr-codes'),
    ).toBeUndefined();
  });

  it('renders poster download buttons and the loader snippet in the detail view', async () => {
    routeApi();
    renderWithProviders(<QrPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'PNG 300px' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'PNG 600px' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PNG 1200px' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument();
    expect(screen.getByText(/loyalty-loader\.js/)).toBeInTheDocument();
  });

  it('shows the scan list with the phone masked and a new-phone badge', async () => {
    routeApi();
    renderWithProviders(<QrPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));

    await waitFor(() => expect(screen.getByText('******3210')).toBeInTheDocument());
    expect(screen.queryByText('9876543210')).not.toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
  });

  it('pauses an active QR code', async () => {
    routeApi();
    renderWithProviders(<QrPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/qr-codes/q1/status',
      );
      expect(call).toBeDefined();
      expect(call?.[2]).toEqual({ status: 'PAUSED' });
    });
  });
});

describe('validate (QR form)', () => {
  const good = {
    eventName: 'Diwali Expo',
    pointsPerScan: '100',
    maxScans: '0',
    startsAt: '2026-01-01T00:00',
    expiresAt: '2026-12-31T00:00',
    claimMessage: '',
  };

  it('passes a complete form', () => {
    expect(validate(good)).toEqual({});
  });

  it('keys each message to the field that owns it', () => {
    const errors = validate({
      ...good,
      eventName: '  ',
      pointsPerScan: '0',
      maxScans: '-1',
      startsAt: '',
    });
    expect(errors.eventName).toMatch(/required/i);
    expect(errors.pointsPerScan).toMatch(/at least 1/i);
    expect(errors.maxScans).toMatch(/0 \(unlimited\) or more/i);
    expect(errors.startsAt).toMatch(/required/i);
  });

  it('blames the expiry for an inverted date range', () => {
    const errors = validate({
      ...good,
      startsAt: '2026-12-31T00:00',
      expiresAt: '2026-01-01T00:00',
    });
    expect(errors.expiresAt).toMatch(/after the start date/i);
    expect(errors.startsAt).toBeUndefined();
  });

  it('reports a missing expiry as missing, not as an inverted range', () => {
    const errors = validate({ ...good, expiresAt: '' });
    expect(errors.expiresAt).toMatch(/required/i);
  });
});

describe('QrPage — validation', () => {
  it('marks mandatory fields and reports errors against their own inputs', async () => {
    routeApi([]);
    renderWithProviders(<QrPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New QR code' }));

    for (const label of ['Event name', 'Coins per scan', 'Starts at', 'Expires at']) {
      const marked = screen
        .getAllByText(new RegExp(`^${label}`))
        .some((el) => /\*/.test(el.textContent ?? '') && /\(required\)/.test(el.textContent ?? ''));
      expect(marked, `${label} should be marked required`).toBe(true);
    }
    expect(screen.getByText(/^Claim message/)).not.toHaveTextContent('*');

    // Event name is blank by default → its own inline message, no lumped banner.
    fireEvent.click(screen.getByRole('button', { name: 'Create QR code' }));
    await waitFor(() => expect(screen.getByText('Event name is required.')).toBeInTheDocument());
    expect(screen.queryByText('QR code is invalid')).not.toBeInTheDocument();
    expect(mockedApi.mock.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/qr-codes')).toEqual(
      [],
    );
  });
});
