export const KAFKA_TOPICS = {
  clevertapForwarding: 'clevertap.forwarding',
  googleProductSync: 'google.product-sync',
  wizzyProductSync: 'wizzy.product-sync',
  metaCapi: 'meta.capi',
  loyaltyBulkOps: 'loyalty.bulk-ops',
  loyaltyExports: 'loyalty.exports',
  formsWebhookDelivery: 'forms.webhook-delivery',
  formsEmailNotification: 'forms.email-notification',
  formsExport: 'forms.export',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

export const CLEVERTAP_FORWARDING_TOPIC = KAFKA_TOPICS.clevertapForwarding;

export function dlqTopic(topic: string): string {
  return `${topic}.dlq`;
}
