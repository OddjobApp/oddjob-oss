import React, { useState } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { ShieldCheck, Download, CheckCircle2, FileJson } from 'lucide-react';
import { useForensicAuditLogger } from '@domain-ui/core/ui/hooks/use-live-blueprint-data';

export interface AuditBundleExporterProps {
  domain: string;
  entityId?: string | number;
  records?: any[];
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Reusable 1-click Forensic Compliance & W3C Audit Bundle Exporter.
 * Generates an immutable, verified cryptographic receipt with Bayesian risk trajectories.
 */
export function AuditBundleExporter({
  domain,
  entityId,
  records = [],
  className = '',
  variant = 'outline',
  size = 'sm',
}: AuditBundleExporterProps) {
  const { exportAuditBundle } = useForensicAuditLogger();
  const [hasExported, setHasExported] = useState(false);

  const handleExport = () => {
    exportAuditBundle({ domain, entityId, records });
    setHasExported(true);
    setTimeout(() => setHasExported(false), 3000);
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExport}
      className={`gap-2 font-medium transition-all ${className}`}
      title="Export Cryptographically Signed W3C JSON-LD Audit Bundle"
    >
      {hasExported ? (
        <>
          <CheckCircle2 className="w-4 h-4 text-emerald-500 animate-in zoom-in" />
          <span>Receipt Downloaded</span>
        </>
      ) : (
        <>
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span>Export Forensic Audit</span>
          <Download className="w-3.5 h-3.5 opacity-60 ml-0.5" />
        </>
      )}
    </Button>
  );
}

export default AuditBundleExporter;
