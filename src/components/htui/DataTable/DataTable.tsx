import { useMemo } from "react";
import { Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DataTableData } from "@/shared/types/artifact";
import "./DataTable.css";

const { Title } = Typography;

interface DataTableProps {
  data: DataTableData;
}

function DataTable({ data }: DataTableProps) {
  const columns: ColumnsType<Record<string, string | number>> = useMemo(
    () =>
      data.columns.map((col) => ({
        title: col.label,
        dataIndex: col.key,
        key: col.key,
        render: (val: unknown) => (val != null ? String(val) : "—"),
      })),
    [data.columns],
  );

  const dataSource = useMemo(
    () => data.rows.map((row, i) => ({ ...row, _key: i })),
    [data.rows],
  );

  return (
    <div className="data-table-card">
      {data.title && (
        <Title level={5} style={{ marginBottom: 12 }}>
          {data.title}
        </Title>
      )}
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey="_key"
        size="small"
        pagination={dataSource.length > 10 ? { pageSize: 10, size: "small" } : false}
        scroll={{ x: "max-content" }}
      />
    </div>
  );
}

export default DataTable;
