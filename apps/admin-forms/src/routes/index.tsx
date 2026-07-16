import {
  Alert,
  Card,
  Dropdown,
  Empty,
  Modal,
  MoreOutlined,
  Pagination,
  PlusOutlined,
  PrimaryButton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type FormListItem,
  useCreateForm,
  useDeleteForm,
  useDuplicateForm,
  useForms,
  useToggleFormStatus,
} from '@/hooks/useForms';
import { makeField } from '@/lib/builder-state';

export const Route = createFileRoute('/')({ component: FormsListPage });

/** The minimal starter form a "New Form" click creates before the builder opens. */
export function starterFormInput() {
  return { name: 'Untitled form', schema: [makeField('text', [])] };
}

export function FormsListPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const forms = useForms(page);
  const create = useCreateForm();
  const duplicate = useDuplicateForm();
  const remove = useDeleteForm();
  const toggle = useToggleFormStatus();
  const [deleteTarget, setDeleteTarget] = useState<FormListItem | null>(null);

  const rows = forms.data?.forms ?? [];

  const goToBuilder = (formId: string) => navigate({ to: '/builder/$formId', params: { formId } });

  const onNewForm = () => {
    create.mutate(starterFormInput(), {
      onSuccess: (form) => void goToBuilder(form.id),
    });
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (value: unknown) => <Typography.Text strong>{value as string}</Typography.Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (_v: unknown, record: unknown) => {
        const row = record as FormListItem;
        return (
          <Space size={8}>
            <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status}</Tag>
            <Switch
              size="small"
              aria-label={`Toggle ${row.name}`}
              checked={row.status === 'active'}
              loading={toggle.isPending && toggle.variables?.id === row.id}
              onChange={(checked) => toggle.mutate({ id: row.id, active: checked })}
            />
          </Space>
        );
      },
    },
    {
      title: 'Submissions',
      dataIndex: 'submissionCount',
      key: 'submissionCount',
      render: (value: unknown) => <Typography.Text>{value as number}</Typography.Text>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(value as string).toLocaleDateString()}
        </Typography.Text>
      ),
    },
    {
      title: '',
      dataIndex: 'id',
      key: 'actions',
      render: (_v: unknown, record: unknown) => {
        const row = record as FormListItem;
        return (
          <Dropdown
            menu={{
              items: [
                { key: 'edit', label: 'Edit' },
                { key: 'duplicate', label: 'Duplicate' },
                { key: 'delete', label: 'Delete', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'edit') void goToBuilder(row.id);
                if (key === 'duplicate') {
                  duplicate.mutate(row.id, {
                    onSuccess: (copy) => void goToBuilder(copy.id),
                  });
                }
                if (key === 'delete') setDeleteTarget(row);
              },
            }}
            trigger={['click']}
          >
            <button
              type="button"
              aria-label={`Actions for ${row.name}`}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4 }}
            >
              <MoreOutlined />
            </button>
          </Dropdown>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Typography.Title
            level={2}
            style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
          >
            Forms
          </Typography.Title>
          <Typography.Text type="secondary">
            Create forms for your storefront and view their submissions.
          </Typography.Text>
        </div>
        <PrimaryButton icon={<PlusOutlined />} loading={create.isPending} onClick={onNewForm}>
          New Form
        </PrimaryButton>
      </div>

      {(create.error || duplicate.error || remove.error || toggle.error) && (
        <Alert
          type="error"
          showIcon
          message={
            ((create.error ?? duplicate.error ?? remove.error ?? toggle.error) as Error).message
          }
        />
      )}

      <Card>
        {!forms.isLoading && rows.length === 0 ? (
          <Empty description="No forms yet">
            <PrimaryButton loading={create.isPending} onClick={onNewForm}>
              Create your first form
            </PrimaryButton>
          </Empty>
        ) : (
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <Table
              rowKey="id"
              columns={columns}
              dataSource={rows}
              loading={forms.isLoading}
              pagination={false}
              scroll={{ x: 'max-content' }}
              onRow={(record) => ({
                onClick: (event) => {
                  // Row click opens the builder unless an inline control was hit.
                  const target = event.target as HTMLElement;
                  if (target.closest('button') || target.closest('.ant-switch')) return;
                  void goToBuilder((record as FormListItem).id);
                },
                style: { cursor: 'pointer' },
              })}
            />
            <div style={{ textAlign: 'right' }}>
              <Pagination
                current={page}
                pageSize={20}
                // hasMore pagination: expose "one more page" when the backend
                // says there is one (the API returns no total count).
                total={(page - (forms.data?.hasMore ? 0 : 1)) * 20 + rows.length}
                onChange={(p) => setPage(p)}
              />
            </div>
          </Space>
        )}
      </Card>

      <Modal
        open={deleteTarget !== null}
        title="Delete this form?"
        okText="Delete"
        okButtonProps={{ danger: true, loading: remove.isPending }}
        onOk={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
        }}
        onCancel={() => setDeleteTarget(null)}
      >
        {deleteTarget && deleteTarget.submissionCount > 0 ? (
          <Typography.Paragraph>
            <Typography.Text strong>"{deleteTarget.name}"</Typography.Text> has{' '}
            <Typography.Text strong>
              {deleteTarget.submissionCount} submission
              {deleteTarget.submissionCount === 1 ? '' : 's'}
            </Typography.Text>
            . The form will disappear from your storefront, but its submissions are kept and stay
            exportable.
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph>
            {deleteTarget ? `"${deleteTarget.name}" will be removed from your storefront.` : ''}
          </Typography.Paragraph>
        )}
      </Modal>
    </Space>
  );
}
