import type { ReactNode } from "react";

export function Table({
  headers,
  data,
  className = ""
}: {
  headers: string[];
  data: ReactNode[][];
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate-700">
            {headers.map((header, index) => (
              <th key={index} className="px-4 py-3 text-sm font-medium text-slate-300">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 text-sm text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
