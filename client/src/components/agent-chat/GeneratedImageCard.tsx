import React, { useState } from 'react';
import { PenLine, Copy, Check, ExternalLink, Sparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardFooter, CrewCardHeader } from './CrewCard';

export interface GeneratedImageCardProps {
  url: string;
  title?: string;
  description?: string;
  path?: string;
  /** Explicit generation/loading state for real-time streaming */
  isGenerating?: boolean;
}

export function formatImageAsMarkdown(url: string, title?: string, description?: string): string {
  const alt = title || 'Generated Image';
  const caption = description || title || '';
  return caption ? `\n\n![${alt}](${url})\n*${caption}*\n\n` : `\n\n![${alt}](${url})\n\n`;
}

export function GeneratedImageCard({ url, title, description, isGenerating = false }: GeneratedImageCardProps) {
  const [copied, setCopied] = useState(false);
  const [insertedIntoScribe, setInsertedIntoScribe] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleCopyMarkdown = async () => {
    try {
      const md = formatImageAsMarkdown(url, title, description);
      await navigator.clipboard.writeText(md.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleInsertIntoScribe = () => {
    const md = formatImageAsMarkdown(url, title, description);
    window.dispatchEvent(
      new CustomEvent('scribe:insert-text', {
        detail: {
          text: md,
          source: 'assistant_image',
          imageUrl: url,
          title: title || 'Generated Image',
        },
      }),
    );
    setInsertedIntoScribe(true);
    setTimeout(() => setInsertedIntoScribe(false), 2000);
  };

  const handleOpenExternal = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const loading = !imageLoaded || isGenerating || imageError;

  return (
    <CrewCard testId="turn-artifact">
      <CrewCardHeader
        icon={<Sparkles />}
        title={<span className="block truncate">{title || 'Generated image'}</span>}
        description={description && <span className="line-clamp-2" title={description}>{description}</span>}
      />

      <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden bg-muted/20">
        {loading && (
          <div
            className={`flex w-full flex-col items-center justify-center gap-2 p-8 text-center transition-opacity duration-500 motion-reduce:transition-none ${
              imageLoaded ? 'pointer-events-none absolute inset-0 opacity-0' : 'opacity-100'
            }`}
            data-testid="image-placeholder-preview"
            role={imageError ? 'alert' : 'status'}
          >
            {!imageError && (
              <div
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/5 to-transparent motion-reduce:hidden"
                style={{ animation: 'shimmer 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
              />
            )}
            <Sparkles className={`relative h-5 w-5 ${imageError ? 'text-muted-foreground' : 'text-primary'}`} aria-hidden />
            <p className="relative text-xs font-medium text-foreground">
              {imageError ? 'The image did not load' : isGenerating ? 'Generating the image…' : 'Loading the image…'}
            </p>
            {imageError && (
              <p className="relative text-xs text-muted-foreground">The link may have expired. Open the original to check.</p>
            )}
          </div>
        )}

        <img
          src={url}
          alt={title || 'Generated image'}
          className={`w-full cursor-zoom-in object-contain transition-opacity duration-300 motion-reduce:transition-none ${
            isZoomed ? 'max-h-[800px] cursor-zoom-out' : 'max-h-[480px]'
          } ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setIsZoomed(!isZoomed)}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />

        {imageLoaded && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute bottom-2.5 right-2.5 z-20 h-7 w-7 rounded-full border border-border/60 bg-background/80 shadow-sm backdrop-blur-xs"
            onClick={() => setIsZoomed(!isZoomed)}
            title={isZoomed ? 'Zoom out' : 'Zoom in'}
            aria-label={isZoomed ? 'Zoom out' : 'Zoom in'}
          >
            {isZoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      <CrewCardFooter className="justify-between">
        <Button variant="outline" size="sm" onClick={handleInsertIntoScribe} title="Insert the image at the open Scribe section">
          {insertedIntoScribe ? <Check className="mr-1 h-3.5 w-3.5" /> : <PenLine className="mr-1 h-3.5 w-3.5" />}
          {insertedIntoScribe ? 'Inserted in Scribe' : 'Insert in Scribe'}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCopyMarkdown} title="Copy as a Markdown image">
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy markdown'}
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={handleOpenExternal} title="Open the original in a new tab">
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          Open original
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
