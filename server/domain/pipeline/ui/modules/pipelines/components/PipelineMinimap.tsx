import { useRef, useEffect } from 'react';

interface PipelineMinimapProps {
    steps: Array<{ id: number; x: number; y: number; name: string }>;
    viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
        zoom: number;
    };
    onViewportChange: (x: number, y: number) => void;
    canvasWidth: number;
    canvasHeight: number;
}

export function PipelineMinimap({
    steps,
    viewport,
    onViewportChange,
    canvasWidth,
    canvasHeight,
}: PipelineMinimapProps) {
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const MINIMAP_WIDTH = 200;
    const MINIMAP_HEIGHT = 150;
    const scale = Math.min(
        MINIMAP_WIDTH / canvasWidth,
        MINIMAP_HEIGHT / canvasHeight
    );

    useEffect(() => {
        const canvas = minimapRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

        // Draw background
        ctx.fillStyle = 'var(--color-backgroundTertiary)';
        ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

        // Draw steps
        ctx.fillStyle = 'var(--color-primary)';
        steps.forEach(step => {
            const x = step.x * scale;
            const y = step.y * scale;
            ctx.fillRect(x - 2, y - 2, 4, 4);
        });

        // Draw viewport rectangle
        const viewportX = viewport.x * scale;
        const viewportY = viewport.y * scale;
        const viewportW = (viewport.width / viewport.zoom) * scale;
        const viewportH = (viewport.height / viewport.zoom) * scale;

        ctx.strokeStyle = 'var(--color-focus)';
        ctx.lineWidth = 2;
        ctx.strokeRect(viewportX, viewportY, viewportW, viewportH);
    }, [steps, viewport, canvasWidth, canvasHeight, scale]);

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;

        onViewportChange(x, y);
    };

    return (
        <div className="pipeline-minimap">
            <canvas
                ref={minimapRef}
                width={MINIMAP_WIDTH}
                height={MINIMAP_HEIGHT}
                onClick={handleClick}
                className="minimap-canvas"
            />
        </div>
    );
}
