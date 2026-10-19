
import React from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';

interface PageShellProps {
    children: React.ReactNode;
    title: string;
    description?: string;
    headerAction?: React.ReactNode;
    className?: string;
    contentClassName?: string;
}

export function PageShell({
    children,
    title,
    description,
    headerAction,
    className,
    contentClassName
}: PageShellProps) {
    return (
        <div className={cn("flex flex-col min-h-screen bg-muted/20", className)}>
            <header className="sticky top-0 z-10 flex flex-col border-b bg-background px-4 py-4 shadow-sm md:px-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                            {title}
                        </h1>
                        {description && (
                            <p className="text-sm text-muted-foreground md:text-base">
                                {description}
                            </p>
                        )}
                    </div>
                    {headerAction && (
                        <div className="flex items-center gap-2">
                            {headerAction}
                        </div>
                    )}
                </div>
            </header>

            <main className={cn("flex-1 px-4 py-4", contentClassName)}>
                {children}
            </main>
        </div>
    );
}
