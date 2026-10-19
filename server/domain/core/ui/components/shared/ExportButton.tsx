/**
 * ExportButton Component
 * 
 * A dropdown button that allows users to export table data to CSV or Excel format.
 */

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { exportToCSV, exportToExcel, ExportColumn } from "@/lib/export-utils";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface ExportButtonProps<T extends Record<string, any>> {
    data: T[];
    columns: ExportColumn<T>[];
    filename: string;
    disabled?: boolean;
    variant?: "default" | "outline" | "ghost" | "secondary";
    size?: "default" | "sm" | "lg" | "icon";
}

export function ExportButton<T extends Record<string, any>>({
    data,
    columns,
    filename,
    disabled = false,
    variant = "outline",
    size = "sm",
}: ExportButtonProps<T>) {
    const { toast } = useToast();

    const handleExport = (format: 'csv' | 'excel') => {
        if (data.length === 0) {
            toast({
                title: "No data to export",
                description: "There are no records to export.",
                variant: "destructive",
            });
            return;
        }

        try {
            const timestamp = new Date().toISOString().split('T')[0];
            const exportFilename = `${filename}_${timestamp}`;

            if (format === 'csv') {
                exportToCSV(data, columns, exportFilename);
            } else {
                exportToExcel(data, columns, exportFilename);
            }

            toast({
                title: "Export successful",
                description: `Exported ${data.length} records to ${format.toUpperCase()}.`,
            });
        } catch (error) {
            toast({
                title: "Export failed",
                description: "An error occurred while exporting the data.",
                variant: "destructive",
            });
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant={variant}
                    size={size}
                    disabled={disabled}
                    aria-label="Export data"
                    title="Export data to file"
                >
                    <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                    Export
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    onClick={() => handleExport('csv')}
                    aria-label="Export data as CSV file"
                >
                    <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                    Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => handleExport('excel')}
                    aria-label="Export data as Excel file"
                >
                    <FileSpreadsheet className="w-4 h-4 mr-2" aria-hidden="true" />
                    Export as Excel
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default ExportButton;

