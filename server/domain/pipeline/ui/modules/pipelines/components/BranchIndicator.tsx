interface BranchIndicatorProps {
    type: 'true' | 'false';
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    condition?: string;
    isActive?: boolean;
}

export function BranchIndicator({
    type,
    fromX,
    fromY,
    toX,
    toY,
    condition,
    isActive = false,
}: BranchIndicatorProps) {
    const color = type === 'true'
        ? 'var(--color-success)'
        : 'var(--color-error)';

    const activeColor = type === 'true'
        ? 'var(--color-successHover)'
        : 'var(--color-errorHover)';

    // Calculate control points for smooth curve
    const midX = (fromX + toX) / 2;
    const path = `M ${fromX} ${fromY} Q ${midX} ${fromY}, ${midX} ${(fromY + toY) / 2} T ${toX} ${toY}`;

    return (
        <g className="branch-indicator">
            {/* Path */}
            <path
                d={path}
                stroke={isActive ? activeColor : color}
                strokeWidth={isActive ? 3 : 2}
                fill="none"
                strokeDasharray={isActive ? '0' : '5,5'}
                className="branch-path"
            />

            {/* Arrow head */}
            <polygon
                points={`${toX},${toY} ${toX - 6},${toY - 3} ${toX - 6},${toY + 3}`}
                fill={isActive ? activeColor : color}
            />

            {/* Condition label */}
            {condition && (
                <g>
                    <rect
                        x={midX - 30}
                        y={(fromY + toY) / 2 - 12}
                        width={60}
                        height={24}
                        fill="var(--color-background)"
                        stroke={color}
                        strokeWidth={1}
                        rx={4}
                    />
                    <text
                        x={midX}
                        y={(fromY + toY) / 2 + 4}
                        textAnchor="middle"
                        fontSize="12"
                        fill={color}
                        className="branch-label"
                    >
                        {type === 'true' ? '✓' : '✗'} {condition}
                    </text>
                </g>
            )}
        </g>
    );
}
