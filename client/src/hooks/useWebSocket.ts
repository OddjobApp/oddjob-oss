import { useEffect, useRef, useState, useCallback } from "react";

interface WebSocketMessage {
    type: string;
    data?: any;
    userId?: string;
    channel?: string;
}

interface WebSocketOptions {
    url: string;
    userId?: string;
    organizationId?: number;
    channels?: string[];
    onMessage?: (message: WebSocketMessage) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Event) => void;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

interface WebSocketState {
    connected: boolean;
    connecting: boolean;
    error: Error | null;
}

/**
 * WebSocket hook for real-time collaboration
 */
export function useWebSocket(options: WebSocketOptions) {
    const {
        url,
        userId,
        organizationId,
        channels = [],
        onMessage,
        onConnect,
        onDisconnect,
        onError,
        reconnectInterval = 3000,
        maxReconnectAttempts = 5,
    } = options;

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

    const [state, setState] = useState<WebSocketState>({
        connected: false,
        connecting: false,
        error: null,
    });

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        setState(prev => ({ ...prev, connecting: true, error: null }));

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                setState({ connected: true, connecting: false, error: null });
                reconnectAttemptsRef.current = 0;
                onConnect?.();

                // Authenticate and subscribe to channels
                if (userId && organizationId) {
                    ws.send(JSON.stringify({
                        type: "authenticate",
                        userId,
                        organizationId,
                    }));

                    channels.forEach(channel => {
                        ws.send(JSON.stringify({
                            type: "subscribe",
                            channel,
                        }));
                    });
                }
            };

            ws.onmessage = (event) => {
                try {
                    const message: WebSocketMessage = JSON.parse(event.data);
                    onMessage?.(message);
                } catch (error) {
                    console.error("Failed to parse WebSocket message:", error);
                }
            };

            ws.onclose = () => {
                setState({ connected: false, connecting: false, error: null });
                onDisconnect?.();

                // Attempt reconnection
                if (reconnectAttemptsRef.current < maxReconnectAttempts) {
                    reconnectAttemptsRef.current++;
                    reconnectTimerRef.current = setTimeout(() => {
                        connect();
                    }, reconnectInterval);
                }
            };

            ws.onerror = (error) => {
                setState(prev => ({ ...prev, error: new Error("WebSocket error") }));
                onError?.(error);
            };
        } catch (error) {
            setState(prev => ({ ...prev, connecting: false, error: error as Error }));
        }
    }, [url, userId, organizationId, channels, onConnect, onDisconnect, onError, reconnectInterval, maxReconnectAttempts]);

    const disconnect = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setState({ connected: false, connecting: false, error: null });
    }, []);

    const sendMessage = useCallback((message: WebSocketMessage) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
        } else {
            console.warn("WebSocket is not connected");
        }
    }, []);

    const subscribe = useCallback((channel: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "subscribe",
                channel,
            }));
        }
    }, []);

    const unsubscribe = useCallback((channel: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: "unsubscribe",
                channel,
            }));
        }
    }, []);

    const updatePresence = useCallback((data: { workbench?: string; resource?: string; cursor?: any }) => {
        sendMessage({
            type: "presence_update",
            data,
        });
    }, [sendMessage]);

    const addComment = useCallback((data: { resource: string; content: string }) => {
        sendMessage({
            type: "comment_add",
            data,
        });
    }, [sendMessage]);

    const updateCursor = useCallback((cursor: any) => {
        sendMessage({
            type: "cursor_update",
            data: { cursor },
        });
    }, [sendMessage]);

    useEffect(() => {
        connect();

        return () => {
            disconnect();
        };
    }, [connect, disconnect]);

    return {
        ...state,
        sendMessage,
        subscribe,
        unsubscribe,
        updatePresence,
        addComment,
        updateCursor,
        connect,
        disconnect,
    };
}
