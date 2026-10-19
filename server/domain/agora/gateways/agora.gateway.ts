import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('AgoraGateway');

interface AgoraMessage {
  type: 'JOIN' | 'UPDATE_OBJECT' | 'REMOVE_OBJECT';
  payload: any;
}

// In-memory store for rooms and their connected clients and canvas states
const rooms = new Map<string, Set<WebSocket>>();
const roomStates = new Map<string, any>();

export class AgoraGateway {
  private static wss: WebSocketServer;

  static initialize() {
    this.wss = new WebSocketServer({ noServer: true });
    logger.info('Agora WebSocket Gateway initialized (Passive mode).');

    this.wss.on('connection', (ws, request) => {
      let currentRoom: string | null = null;

      ws.on('message', async (message) => {
        try {
          const parsedMessage: AgoraMessage = JSON.parse(message.toString());

          switch (parsedMessage.type) {
            case 'JOIN':
              const roomId = parsedMessage.payload.roomId || 
                (parsedMessage.payload.approvalId ? `deliberation-${parsedMessage.payload.approvalId}` : 
                 (parsedMessage.payload.missionId ? `mission-${parsedMessage.payload.missionId}` : 'default-room'));
              const missionId = parsedMessage.payload.missionId;
              
              if (currentRoom) {
                rooms.get(currentRoom)?.delete(ws);
              }
              if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
              }
              rooms.get(roomId)?.add(ws);
              currentRoom = roomId;
              logger.info(`Client joined Agora room: ${roomId}`);

              // Load and send initial state
              if (roomStates.has(roomId)) {
                ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload: roomStates.get(roomId) }));
                break;
              }

              if (missionId) {
                try {
                  const { db } = await import('@server/database_service.js');
                  const { agoraSessions } = await import('@shared/schema/agora.js');
                  const { eq } = await import('drizzle-orm');
                  
                  let [session] = await db.select().from(agoraSessions).where(eq(agoraSessions.missionId, missionId));
                  if (!session) {
                    [session] = await db.insert(agoraSessions).values({
                      missionId,
                      canvasState: { nodes: [], edges: [] }
                    }).returning();
                  }
                  
                  roomStates.set(roomId, session.canvasState);
                  ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload: session.canvasState }));
                } catch (dbErr) {
                  logger.error('Failed to load Agora session state', { error: dbErr });
                  ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload: { nodes: [], edges: [] } }));
                }
              } else {
                const emptyState = { nodes: [], edges: [] };
                roomStates.set(roomId, emptyState);
                ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload: emptyState }));
              }
              break;

            case 'UPDATE_OBJECT':
              if (currentRoom) {
                if (parsedMessage.payload) {
                  roomStates.set(currentRoom, parsedMessage.payload);
                }
                this.broadcast(currentRoom, parsedMessage, ws);
                
                // Save state to DB if mission-linked
                if (currentRoom.startsWith('mission-')) {
                  const mId = parseInt(currentRoom.replace('mission-', ''));
                  if (!isNaN(mId) && parsedMessage.payload.nodes && parsedMessage.payload.edges) {
                    try {
                      const { db } = await import('@server/database_service.js');
                      const { agoraSessions } = await import('@shared/schema/agora.js');
                      const { eq } = await import('drizzle-orm');
                      
                      await db.update(agoraSessions)
                          .set({ canvasState: parsedMessage.payload, updatedAt: new Date() })
                          .where(eq(agoraSessions.missionId, mId));
                    } catch (saveErr) {
                      logger.error('Failed to save Agora session state', { error: saveErr });
                    }
                  }
                }
              }
              break;

            case 'REMOVE_OBJECT':
              if (currentRoom) {
                this.broadcast(currentRoom, parsedMessage, ws);
              }
              break;
          }
        } catch (error) {
          logger.warn('Failed to parse WebSocket message', { error });
        }
      });

      ws.on('close', () => {
        if (currentRoom) {
          rooms.get(currentRoom)?.delete(ws);
          logger.info(`Client left room: ${currentRoom}`);
        }
      });
    });
  }

  static handleUpgrade(request: any, socket: any, head: any) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Broadcasts a message to all clients in a room, optionally excluding the sender.
   */
  static broadcast(room: string, message: AgoraMessage, exclude?: WebSocket) {
    const clients = rooms.get(room);
    if (clients) {
      for (const client of clients) {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      }
    }
  }

  /**
   * Broadcasts a message from the system to all clients in a room.
   */
  static systemBroadcast(room: string, type: AgoraMessage['type'], payload: any) {
    this.broadcast(room, { type, payload });
  }
}
