import { DragDropContext, Droppable, Draggable, DropResult, DroppableProvided, DroppableStateSnapshot, DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';

interface DraggableStepListProps {
    steps: Array<{
        id: number;
        name: string;
        jobType: string;
        order: number;
    }>;
    onReorder: (startIndex: number, endIndex: number) => void;
    renderStep: (step: any, index: number) => React.ReactNode;
}

export function DraggableStepList({
    steps,
    onReorder,
    renderStep,
}: DraggableStepListProps) {
    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) return;

        const sourceIndex = result.source.index;
        const destIndex = result.destination.index;

        if (sourceIndex === destIndex) return;

        onReorder(sourceIndex, destIndex);
    };

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="pipeline-steps">
                {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                    <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`step-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                    >
                        {steps.map((step, index) => (
                            <Draggable
                                key={step.id}
                                draggableId={`step-${step.id}`}
                                index={index}
                            >
                                {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={`draggable-step ${snapshot.isDragging ? 'dragging' : ''}`}
                                    >
                                        {renderStep(step, index)}
                                    </div>
                                )}
                            </Draggable>
                        ))}
                        {provided.placeholder}
                    </div>
                )}
            </Droppable>
        </DragDropContext>
    );
}
