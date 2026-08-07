import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRunningStatus, isStalled, jobPollInterval } from './useLoyalty';

/**
 * A background job that never finishes (lost SQS message, stopped worker,
 * DLQ'd batch) sits on `processing` forever. A fixed 2s interval would then
 * refetch every 2 seconds for as long as the tab stays open — on every open
 * tab. These rules are what stop that.
 */

const NOW = Date.parse('2026-08-08T12:00:00.000Z');
const agoIso = (ms: number) => new Date(NOW - ms).toISOString();

function freezeClock() {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
}

afterEach(() => vi.restoreAllMocks());

describe('jobPollInterval', () => {
  it('does not poll a job that has already finished', () => {
    freezeClock();
    expect(jobPollInterval(false, agoIso(0))).toBe(false);
  });

  it('polls fast while the server is actively touching the job', () => {
    freezeClock();
    expect(jobPollInterval(true, agoIso(1_000))).toBe(2_000);
    expect(jobPollInterval(true, agoIso(29_000))).toBe(2_000);
  });

  it('backs off as the job goes quiet', () => {
    freezeClock();
    expect(jobPollInterval(true, agoIso(31_000))).toBe(5_000);
    expect(jobPollInterval(true, agoIso(119_000))).toBe(5_000);
    expect(jobPollInterval(true, agoIso(121_000))).toBe(15_000);
  });

  it('#stops-when-stalled: gives up entirely past the stall window', () => {
    freezeClock();
    expect(jobPollInterval(true, agoIso(5 * 60_000))).toBe(false);
    expect(jobPollInterval(true, agoIso(60 * 60_000))).toBe(false);
  });

  it('polls at the base rate when the server gave no timestamp', () => {
    freezeClock();
    expect(jobPollInterval(true, undefined)).toBe(2_000);
    expect(jobPollInterval(true, 'not-a-date')).toBe(2_000);
  });

  it('treats a future timestamp as fresh, not as stalled long ago', () => {
    // Clock skew between the browser and the API must not kill the poll.
    freezeClock();
    expect(jobPollInterval(true, new Date(NOW + 120_000).toISOString())).toBe(2_000);
  });
});

describe('isStalled', () => {
  it('is true only for a running job the server stopped touching', () => {
    freezeClock();
    expect(isStalled('processing', agoIso(5 * 60_000))).toBe(true);
    expect(isStalled('processing', agoIso(10_000))).toBe(false);
    // A finished job is not stalled, however old it is.
    expect(isStalled('done', agoIso(60 * 60_000))).toBe(false);
    expect(isStalled('failed', agoIso(60 * 60_000))).toBe(false);
    // No signal at all → don't cry wolf.
    expect(isStalled('processing', undefined)).toBe(false);
  });
});

describe('isRunningStatus', () => {
  it('covers every non-terminal status the API can report', () => {
    expect(['pending', 'validating', 'processing'].every(isRunningStatus)).toBe(true);
    expect(['done', 'failed', 'awaiting_confirm'].some(isRunningStatus)).toBe(false);
  });
});
