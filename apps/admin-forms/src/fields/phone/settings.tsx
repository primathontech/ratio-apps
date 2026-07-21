import { Alert } from '@primathonos/orion';

export function PhoneSettings() {
  return (
    <Alert
      type="info"
      showIcon
      message="+91, 10 digits"
      description="Indian mobile numbers only."
    />
  );
}
