import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * "Send test payload" (builder screen): POSTs a dummy `form.submitted`
 * payload to the form's webhook URL and reports the endpoint's response
 * status code (null = network error / no response).
 */
export function useWebhookTest(formId: string) {
  return useMutation({
    mutationFn: () =>
      api<{ statusCode: number | null }>('POST', `/api/forms/${formId}/webhook-test`),
  });
}
