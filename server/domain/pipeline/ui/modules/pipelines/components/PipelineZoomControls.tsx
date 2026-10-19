import { useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface PipelineZoomControlsProps {
    zoom: number;
    onZoomChange: (zoom: number) => void;
    onFitToScreen: () => void;
    minZoom?: number;
    maxZoom?: number;
}

export function PipelineZoomControls({
    zoom,
    onZoomChange,
    onFitToScreen,
    minZoom = 0.25,
    maxZoom = 2,
}: PipelineZoomControlsProps) {
    const handleZoomIn = () => {
        const newZoom = Math.min(zoom + 0.1, maxZoom);
        onZoomChange(newZoom);
    };

    const handleZoomOut = () => {
        const newZoom = Math.max(zoom - 0.1, minZoom);
        onZoomChange(newZoom);
    };

    const handleReset = () => {
        onZoomChange(1);
    };

    return (
        <div className="pipeline-zoom-controls">
            <button
                onClick={handleZoomOut}
                disabled={zoom <= minZoom}
                title="Zoom Out"
                aria-label="Zoom out"
                className="zoom-btn"
            >
                <ZoomOut className="w-4 h-4" />
            </button>

            <button
                onClick={handleReset}
                title="Reset Zoom (100%)"
                className="zoom-level"
            >
                {Math.round(zoom * 100)}%
            </button>

            <button
                onClick={handleZoomIn}
                disabled={zoom >= maxZoom}
                title="Zoom In"
                aria-label="Zoom in"
                className="zoom-btn"
            >
                <ZoomIn className="w-4 h-4" />
            </button>

            <div className="zoom-divider" />

            <button
                onClick={onFitToScreen}
                title="Fit to Screen"
                aria-label="Fit pipeline to screen"
                className="zoom-btn"
            >
                <Maximize2 className="w-4 h-4" />
            </button>
        </div>
    );
}
