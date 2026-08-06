import {
  Button,
  DatabaseOutlined,
  Drawer,
  ExclamationCircleOutlined,
  HomeOutlined,
  Layout,
  Menu,
  MenuOutlined,
  SettingOutlined,
  SyncOutlined,
  Typography,
  WarningOutlined,
} from '@primathonos/orion';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const items = [
  { key: '/', icon: <HomeOutlined />, label: <Link to="/">Overview</Link> },
  { key: '/sync', icon: <DatabaseOutlined />, label: <Link to="/sync">All Activity</Link> },
  {
    key: '/failed-syncs',
    icon: <ExclamationCircleOutlined />,
    label: <Link to="/failed-syncs">Failed Syncs</Link>,
  },
  {
    key: '/reconciliation',
    icon: <SyncOutlined />,
    label: <Link to="/reconciliation">Reconciliation</Link>,
  },
  { key: '/alerts', icon: <WarningOutlined />, label: <Link to="/alerts">Alerts</Link> },
  { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> },
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
        Unicommerce · Ratio
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
