/**
 * App Preview Thumbnail Widget
 * 
 * Shows app preview for rolling wave missions.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { ExternalLink } from "lucide-react";

interface AppPreviewThumbnailWidgetProps {
  mission?: any;
  run?: any;
}

export default function AppPreviewThumbnailWidget({ mission, run }: AppPreviewThumbnailWidgetProps) {
  const appSlug = mission?.blackboard?.viaAppSlug || mission?.blackboard?.forge_app_slug;
  const hasPreview = !!appSlug;

  return (
    <Card className="bg-background/40 backdrop-blur-md border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-bold uppercase tracking-wider">App Preview</CardTitle>
      </CardHeader>
      <CardContent>
        {hasPreview ? (
          <a 
            href={`/apps/${appSlug}`}
            className="block p-3 bg-muted/50 rounded border border-border hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium truncate">{appSlug}</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </a>
        ) : (
          <div className="p-3 bg-muted/30 rounded border border-dashed border-border text-center">
            <p className="text-xs text-muted-foreground">No app linked</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
