// ============================================================================
// WEBSOCKET HOOK - Manages connection to backend
// ============================================================================

import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage, WSMessageType } from '../../shared/types';

type MessageHandler = (message: WSMessage) => void;

interface UseWebSocketOptions {
  url: string;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  reconnectDelay?: number;
}

interface UseWebSocketReturn {
  connected: boolean;
  connecting: boolean;
  send: <T>(type: WSMessageType, payload: T, sessionId?: string) => void;
  subscribe: (type: WSMessageType | WSMessageType[], handler: MessageHandler) => () => void;
  lastMessage: WSMessage | null;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    reconnectDelay = 2000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectTimeoutRef = useRef<number>();
  const callbacksRef = useRef({ onOpen, onClose, onError });

  // Update callbacks ref when they change
  callbacksRef.current = { onOpen, onClose, onError };

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  // Initialize connection - only run once on mount
  useEffect(() => {
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

      setConnecting(true);
      console.log('[WebSocket] Connecting to', url);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setConnected(true);
        setConnecting(false);
        callbacksRef.current.onOpen?.();
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setConnected(false);
        setConnecting(false);
        wsRef.current = null;
        callbacksRef.current.onClose?.();

        // Reconnect
        if (reconnect) {
          console.log(`[WebSocket] Reconnecting in ${reconnectDelay}ms...`);
          reconnectTimeoutRef.current = window.setTimeout(connect, reconnectDelay);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        callbacksRef.current.onError?.(error);
      };

      ws.onmessage = (event) => {
        // Handle binary messages (video frames)
        if (event.data instanceof Blob) {
          const handlers = handlersRef.current.get('binary');
          if (handlers) {
            const binaryMessage: WSMessage = {
              type: 'webrtc:offer' as WSMessageType, // Using as binary frame indicator
              payload: event.data,
              timestamp: Date.now(),
            };
            handlers.forEach((handler) => handler(binaryMessage));
          }
          return;
        }

        // Handle JSON messages
        try {
          const message: WSMessage = JSON.parse(event.data);
          setLastMessage(message);

          // Notify type-specific handlers
          const typeHandlers = handlersRef.current.get(message.type);
          if (typeHandlers) {
            typeHandlers.forEach((handler) => handler(message));
          }

          // Notify wildcard handlers
          const wildcardHandlers = handlersRef.current.get('*');
          if (wildcardHandlers) {
            wildcardHandlers.forEach((handler) => handler(message));
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, reconnect, reconnectDelay]);

  // Send message
  const send = useCallback(<T,>(type: WSMessageType, payload: T, sessionId?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Not connected, cannot send message');
      return;
    }

    const message: WSMessage<T> = {
      type,
      payload,
      sessionId,
      timestamp: Date.now(),
    };

    wsRef.current.send(JSON.stringify(message));
  }, []);

  // Subscribe to messages
  const subscribe = useCallback(
    (type: WSMessageType | WSMessageType[], handler: MessageHandler): (() => void) => {
      const types = Array.isArray(type) ? type : [type];

      types.forEach((t) => {
        if (!handlersRef.current.has(t)) {
          handlersRef.current.set(t, new Set());
        }
        handlersRef.current.get(t)!.add(handler);
      });

      // Return unsubscribe function
      return () => {
        types.forEach((t) => {
          handlersRef.current.get(t)?.delete(handler);
        });
      };
    },
    []
  );

  return {
    connected,
    connecting,
    send,
    subscribe,
    lastMessage,
  };
}
