import { Layout, Result } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/disabled')({ component: DisabledPage });

export function DisabledPage() {
  return (
    <Layout
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
      }}
    >
      <Result
        status="403"
        title="App disabled"
        subTitle="This merchant has uninstalled CleverTap for Ratio. Your settings are preserved. Reinstall from the Ratio marketplace to restore access."
      />
    </Layout>
  );
}
