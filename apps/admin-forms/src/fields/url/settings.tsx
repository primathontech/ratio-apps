import { Alert } from '@primathonos/orion';

export function UrlSettings() {
  return (
    <Alert
      type="info"
      showIcon
      message="URL field"
      description="Validated as a URL when the form is submitted."
    />
  );
}
