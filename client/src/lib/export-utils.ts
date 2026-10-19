/**
 * Export Utilities for CSV and Excel Downloads
 * 
 * Provides functions to export data from tables to CSV format
 * and trigger browser downloads.
 */

export interface ExportColumn<T> {
    key: keyof T | string;
    header: string;
    formatter?: (value: any, row: T) => string;
}

/**
 * Convert an array of objects to CSV string
 */
export function toCSV<T extends Record<string, any>>(
    data: T[],
    columns: ExportColumn<T>[]
): string {
    // CSV header row
    const headers = columns.map(col => escapeCSV(col.header));

    // Data rows
    const rows = data.map(row =>
        columns.map(col => {
            const value = getNestedValue(row, col.key as string);
            const formatted = col.formatter ? col.formatter(value, row) : value;
            return escapeCSV(String(formatted ?? ''));
        })
    );

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 */
function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/csv'): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Export data to CSV and download
 */
export function exportToCSV<T extends Record<string, any>>(
    data: T[],
    columns: ExportColumn<T>[],
    filename: string
): void {
    const csv = toCSV(data, columns);
    downloadFile(csv, `${filename}.csv`, 'text/csv');
}

/**
 * Export data to Excel-compatible format (TSV with .xlsx extension)
 * Note: This creates a TSV file that Excel can open - for true XLSX,
 * you'd need a library like xlsx or exceljs
 */
export function exportToExcel<T extends Record<string, any>>(
    data: T[],
    columns: ExportColumn<T>[],
    filename: string
): void {
    // Use tab separator for better Excel compatibility
    const headers = columns.map(col => col.header);
    const rows = data.map(row =>
        columns.map(col => {
            const value = getNestedValue(row, col.key as string);
            const formatted = col.formatter ? col.formatter(value, row) : value;
            return String(formatted ?? '').replace(/\t/g, ' '); // Remove tabs from values
        })
    );

    const content = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    // Use .xls extension with HTML table for better Excel import
    const htmlTable = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
  <meta charset="UTF-8">
  <!--[if gte mso 9]><xml>
    <x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
      <x:Name>Export</x:Name>
      <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
  </xml><![endif]-->
</head>
<body>
  <table>
    <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n      ')}
    </tbody>
  </table>
</body>
</html>`;

    downloadFile(htmlTable, `${filename}.xls`, 'application/vnd.ms-excel');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Format date for export
 */
export function formatDateForExport(date: string | Date | null | undefined): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Format boolean for export
 */
export function formatBooleanForExport(value: boolean | null | undefined): string {
    if (value === null || value === undefined) return '';
    return value ? 'Yes' : 'No';
}

/**
 * Format JSON for export (single-line, safe for CSV)
 */
export function formatJSONForExport(value: any): string {
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
