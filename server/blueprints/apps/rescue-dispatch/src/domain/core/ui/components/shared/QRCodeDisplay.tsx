import React, { useState } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@domain-ui/core/ui/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { 
  QrCode, 
  Copy, 
  Download, 
  Share2, 
  Link as LinkIcon, 
  ExternalLink,
  MoreVertical,
  Trash2,
  BarChart3,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

// ============================================================================
// QR CODE DISPLAY COMPONENT
// Displays a QR code with download and share options
// ============================================================================

export interface QRCodeDisplayProps {
  dataUrl: string;
  title?: string;
  description?: string;
  shortUrl?: string;
  targetUrl?: string;
  size?: number;
  onDownload?: () => void;
  onShare?: () => void;
  className?: string;
}

export function QRCodeDisplay({
  dataUrl,
  title = "Scan to Access",
  description,
  shortUrl,
  targetUrl,
  size = 256,
  onDownload,
  onShare,
  className
}: QRCodeDisplayProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Copied to clipboard", duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleDownload = () => {
    if (!dataUrl) return;
    
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-code-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    onDownload?.();
    toast({ title: "QR code downloaded" });
  };

  const handleShare = async () => {
    if (navigator.share && (shortUrl || targetUrl)) {
      try {
        await navigator.share({
          title: title,
          text: description || `Access via QR code`,
          url: shortUrl || targetUrl,
        });
        onShare?.();
      } catch (err) {
        // User cancelled or share failed
      }
    } else {
      handleCopy(shortUrl || targetUrl || '');
    }
  };

  return (
    <Card className={cn("w-fit", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <QrCode className="h-4 w-4" />
          {title}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* QR Code Image */}
        {dataUrl ? (
          <div className="relative group">
            <img
              src={dataUrl}
              alt="QR Code"
              className="rounded-lg border"
              style={{ width: size, height: size }}
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </div>
          </div>
        ) : (
          <div 
            className="rounded-lg border bg-muted flex items-center justify-center"
            style={{ width: size, height: size }}
          >
            <QrCode className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        {/* URL Display */}
        {(shortUrl || targetUrl) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shortUrl || targetUrl}
                className="text-xs font-mono"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => handleCopy(shortUrl || targetUrl || '')}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleShare}>
            <Share2 className="h-4 w-4 mr-1" />
            Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// SHORTLINK CARD COMPONENT
// Displays a shortlink with QR code and stats
// ============================================================================

export interface ShortlinkCardProps {
  code: string;
  shortUrl: string;
  targetUrl: string;
  title?: string;
  clickCount: number;
  lastClickedAt?: Date;
  qrCodeDataUrl?: string;
  onDelete?: () => void;
  onViewStats?: () => void;
  className?: string;
}

export function ShortlinkCard({
  code,
  shortUrl,
  targetUrl,
  title,
  clickCount,
  lastClickedAt,
  qrCodeDataUrl,
  onDelete,
  onViewStats,
  className
}: ShortlinkCardProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      toast({ title: "Shortlink copied", duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              {title || "Shortlink"}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {clickCount} clicks
              {lastClickedAt && ` • Last used ${new Date(lastClickedAt).toLocaleDateString()}`}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onViewStats}>
                <BarChart3 className="h-4 w-4 mr-2" />
                View Stats
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* QR Code Preview */}
        {qrCodeDataUrl && (
          <Dialog>
            <DialogTrigger asChild>
              <div className="cursor-pointer hover:opacity-80 transition-opacity">
                <img
                  src={qrCodeDataUrl}
                  alt="QR Code"
                  className="rounded-lg border w-full max-w-[200px] mx-auto"
                />
              </div>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>QR Code</DialogTitle>
              </DialogHeader>
              <QRCodeDisplay
                dataUrl={qrCodeDataUrl}
                shortUrl={shortUrl}
                targetUrl={targetUrl}
                size={300}
              />
            </DialogContent>
          </Dialog>
        )}

        {/* URL Display */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={shortUrl}
              className="text-xs font-mono"
            />
            <Button
              size="icon"
              variant="outline"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => window.open(shortUrl, '_blank')}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            → {targetUrl}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// AGENT SHARE DIALOG
// Combines shortlink and QR code sharing for agents
// ============================================================================

export interface AgentShareDialogProps {
  agentSlug: string;
  agentTitle: string;
  trigger?: React.ReactNode;
}

export function AgentShareDialog({ agentSlug, agentTitle, trigger }: AgentShareDialogProps) {
  const [shortlinks, setShortlinks] = useState<ShortlinkCardProps[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const fetchShortlinks = async () => {
    try {
      const res = await fetch(`/api/agents/${agentSlug}/shortlinks`);
      if (res.ok) {
        const data = await res.json();
        setShortlinks(data);
      }
    } catch (err) {
      console.error("Failed to fetch shortlinks:", err);
    }
  };

  const createShortlink = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentSlug}/shortlinks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: agentTitle,
          generateQR: true,
        }),
      });

      if (res.ok) {
        await fetchShortlinks();
        toast({ title: "Shortlink created" });
      } else {
        throw new Error("Failed to create shortlink");
      }
    } catch (err) {
      toast({ title: "Failed to create shortlink", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      fetchShortlinks();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Share2 className="h-4 w-4 mr-1" />
            Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share {agentTitle}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="shortlinks" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="shortlinks">Short Links</TabsTrigger>
            <TabsTrigger value="qrcode">QR Code</TabsTrigger>
          </TabsList>

          <TabsContent value="shortlinks" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {shortlinks.length} shortlink{shortlinks.length !== 1 ? 's' : ''}
              </p>
              <Button 
                size="sm" 
                onClick={createShortlink}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <span className="animate-spin mr-1">⏳</span>
                    Creating...
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-4 w-4 mr-1" />
                    Create Shortlink
                  </>
                )}
              </Button>
            </div>

            {shortlinks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <LinkIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No shortlinks yet</p>
                <p className="text-sm">Create one to share this agent</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {shortlinks.map((link) => (
                  <ShortlinkCard
                    key={link.code}
                    {...link}
                    onDelete={async () => {
                      await fetch(`/api/shortlinks/${link.code}`, { method: 'DELETE' });
                      fetchShortlinks();
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="qrcode" className="space-y-4 mt-4">
            <div className="flex justify-center">
              <QRCodeDisplay
                dataUrl={shortlinks[0]?.qrCodeDataUrl || ''}
                shortUrl={shortlinks[0]?.shortUrl}
                targetUrl={`${window.location.origin}/a/${agentSlug}`}
                size={300}
                title="Scan to Chat"
                description="Point your camera at this QR code to start chatting with the agent"
              />
            </div>
            {!shortlinks[0]?.qrCodeDataUrl && (
              <div className="text-center">
                <Button onClick={createShortlink} disabled={isLoading}>
                  {isLoading ? 'Generating...' : 'Generate QR Code'}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default QRCodeDisplay;
