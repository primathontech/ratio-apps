import { Alert, Card, Space, Typography } from '@primathonos/orion';

/**
 * Placeholder for an FBT admin screen whose backend endpoints do not exist yet.
 *
 * The route skeleton mirrors the standalone FBT admin (`osapp-freq-bought/admin`)
 * so the navigation and information architecture are settled before the screens
 * are built. Each screen names the plan that fills it in.
 *
 * Deliberately inert: it renders no form controls. A half-wired form that POSTs
 * to an endpoint which does not exist yet is worse than an honest placeholder —
 * the merchant gets a silent failure instead of a clear "not ready".
 */
export function PlannedScreen({
  title,
  purpose,
  controls,
  plan,
}: {
  title: string;
  purpose: string;
  /** The settings or data this screen will own, one entry per row. */
  controls: string[];
  /** Which implementation plan delivers it. */
  plan: string;
}) {
  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">{purpose}</Typography.Text>
      </div>
      <Card title="Not built yet">
        <Alert
          type="info"
          showIcon
          message={`Delivered by ${plan}.`}
          description="The route exists so navigation and layout are settled; the controls below are what this screen will own."
        />
        <ul style={{ marginTop: 16, marginBottom: 0, paddingLeft: 20 }}>
          {controls.map((c) => (
            <li key={c}>
              <Typography.Text type="secondary">{c}</Typography.Text>
            </li>
          ))}
        </ul>
      </Card>
    </Space>
  );
}
