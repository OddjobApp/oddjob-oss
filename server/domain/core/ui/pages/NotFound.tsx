import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { AlertTriangle, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-3">
            <AlertTriangle className="h-7 w-7 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This page doesn&apos;t exist or may have moved. Check the address, or head back to your dashboard.
            </p>
          </div>
          <Button className="mt-2" onClick={() => { window.location.href = "/dashboard"; }}>
            <Home className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
