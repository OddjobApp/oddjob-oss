import React from 'react';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { ChevronDown, ChevronUp, Trash2, Maximize2, Minimize2 } from 'lucide-react';

export function SeleniumStepItem({ 
    step, 
    index, 
    totalSteps, 
    isExpanded, 
    disabled, 
    onExpand, 
    onUpdate, 
    onRemove, 
    onMove 
}: any) {
    return (
        <Card className="border-mocha-100">
            <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-mocha-400">#{index + 1}</span>
                    <span className="text-sm font-medium text-mocha-800 uppercase tracking-tight">{step.action}</span>
                    <span className="text-xs text-mocha-500 truncate max-w-[200px]">{step.value}</span>
                </div>
                <div className="flex items-center gap-1">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7" 
                        disabled={disabled || index === 0} 
                        onClick={() => onMove('up')}
                    >
                        <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7" 
                        disabled={disabled || index === totalSteps - 1} 
                        onClick={() => onMove('down')}
                    >
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7" 
                        onClick={() => onExpand(isExpanded ? null : index)}
                    >
                        {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" 
                        disabled={disabled} 
                        onClick={onRemove}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </CardContent>
            {isExpanded && (
                <div className="p-3 border-t bg-mocha-50/30">
                    <p className="text-xs text-mocha-500 italic">Automation step details (Legacy stub loaded due to missing module resolution).</p>
                </div>
            )}
        </Card>
    );
}
