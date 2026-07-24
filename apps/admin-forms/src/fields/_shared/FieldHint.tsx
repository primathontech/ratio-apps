import { Divider, Typography } from '@primathonos/orion';

/**
 * A subtle, one-line note for field types that have nothing to configure (or
 * only a fixed behaviour to explain). It mirrors the section rhythm of the real
 * settings panels — a `<Divider>` header plus a compact muted line — so a hint
 * never dominates the panel the way a padded Alert box does.
 */
export function FieldHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>{title}</Divider>
      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
        {children}
      </Typography.Text>
    </>
  );
}
