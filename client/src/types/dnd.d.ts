declare module '@hello-pangea/dnd' {
    import * as React from 'react';

    export type DraggableId = string;
    export type DroppableId = string;
    export type ContextId = string;
    export type TypeId = string;
    export type Combine = {
        draggableId: DraggableId;
        droppableId: DroppableId;
    };

    export type DraggableLocation = {
        droppableId: DroppableId;
        index: number;
    };

    export type DraggableStateSnapshot = {
        isDragging: boolean;
        isDropAnimating: boolean;
        isClone: boolean;
        dropAnimation: any;
        draggingOver: DroppableId | null;
        combineWith: DraggableId | null;
        combineTargetFor: DraggableId | null;
        mode: any;
    };

    export type DroppableStateSnapshot = {
        isDraggingOver: boolean;
        draggingOverWith: DraggableId | null;
        draggingFromThisWith: DraggableId | null;
        isUsingPlaceholder: boolean;
    };

    export type DraggableRubric = {
        draggableId: DraggableId;
        type: TypeId;
        source: DraggableLocation;
    };

    export type DragStart = DraggableRubric & {
        mode: any;
    };

    export type DropResult = {
        draggableId: DraggableId;
        type: TypeId;
        source: DraggableLocation;
        destination?: DraggableLocation | null;
        reason: 'DROP' | 'CANCEL';
        combine?: Combine | null;
        mode: any;
    };

    export type DroppableProvided = {
        innerRef: (element: HTMLElement | null) => any;
        placeholder?: React.ReactNode;
        droppableProps: any;
    };

    export type DraggableProvided = {
        draggableProps: any;
        dragHandleProps: any;
        innerRef: (element: HTMLElement | null) => any;
    };

    export class DragDropContext extends React.Component<any, any> { }
    export class Droppable extends React.Component<any, any> { }
    export class Draggable extends React.Component<any, any> { }
}
