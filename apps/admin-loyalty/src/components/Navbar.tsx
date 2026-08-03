import {
  Button,
  CloudDownloadOutlined,
  Drawer,
  HomeOutlined,
  Layout,
  Menu,
  MenuOutlined,
  QrcodeOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  Typography,
  UploadOutlined,
} from '@primathonos/orion';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const items = [
  { key: '/', icon: <HomeOutlined />, label: <Link to="/">Dashboard</Link> },
  { key: '/bulk', icon: <UploadOutlined />, label: <Link to="/bulk">Bulk Operations</Link> },
  { key: '/rules', icon: <ThunderboltOutlined />, label: <Link to="/rules">Earning Rules</Link> },
  { key: '/qr', icon: <QrcodeOutlined />, label: <Link to="/qr">QR Codes</Link> },
  { key: '/export', icon: <CloudDownloadOutlined />, label: <Link to="/export">Export</Link> },
  { key: '/customers', icon: <TeamOutlined />, label: <Link to="/customers">Customers</Link> },
  { key: '/config', icon: <SettingOutlined />, label: <Link to="/config">Settings</Link> },
];

const MOBILE_BREAKPOINT = 720;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export function Navbar() {
  const { location } = useRouterState();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  return (
    <Layout.Header
      style={{
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: '0 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        height: 56,
        lineHeight: '56px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <Typography.Text
        strong
        style={{
          fontSize: 16,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        Loyalty · Ratio
      </Typography.Text>

      {isMobile ? (
        <>
          <div style={{ flex: 1 }} />
          <Button
            type="text"
            aria-label="Open navigation"
            icon={<MenuOutlined />}
            onClick={() => setOpen(true)}
          />
          <Drawer
            title="Menu"
            placement="right"
            open={open}
            onClose={() => setOpen(false)}
            width={260}
            styles={{ body: { padding: 0 } }}
          >
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              items={items}
              style={{ borderInlineEnd: 'none' }}
              onClick={() => setOpen(false)}
            />
          </Drawer>
        </>
      ) : (
        <Menu
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={items}
          style={{ flex: 1, borderBottom: 'none', minWidth: 0 }}
          overflowedIndicator={<MenuOutlined />}
        />
      )}
    </Layout.Header>
  );
}
