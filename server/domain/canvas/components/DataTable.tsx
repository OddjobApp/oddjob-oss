import React from 'react';

interface DataTableProps {
  data: Record<string, any>[];
}

const DataTable: React.FC<DataTableProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return <p>No data to display.</p>;
  }

  const headers = Object.keys(data[0]);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-card border border-border">
        <thead>
          <tr className="bg-muted">
            {headers.map((header) => (
              <th key={header} className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t hover:bg-muted">
              {headers.map((header) => (
                <td key={`${rowIndex}-${header}`} className="px-4 py-2 text-sm text-foreground">
                  {typeof row[header] === 'object' && row[header] !== null
                    ? JSON.stringify(row[header])
                    : row[header]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;
