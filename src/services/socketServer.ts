import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import logger from '../common/logger';
import config from 'config';
import { config as envConfig } from 'dotenv';

// Load environment variables
envConfig();

class SocketService {
    private static instance: SocketService;
    private io: SocketIOServer;

    private constructor() {
        this.io = new SocketIOServer();
    }

    public static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    public initialize(httpServer: HttpServer): void {
        this.io = new SocketIOServer(httpServer, {
            cors: {
                origin: process.env.CORS_ORIGIN || '*',
                methods: ['GET', 'POST']
            }
        });
        
        logger.info('Socket.IO server initialized');
    }

    public async start(): Promise<void> {
        const wsPort: number = config.get('server.ws_port') || 5001;
        this.io.listen(wsPort, {
            cors: {
                origin: process.env.CORS_ORIGIN || '*',
                methods: ['GET', 'POST']
            }
        });
        logger.info(`WebSocket server is running on port ${wsPort}`);
    }

    public getIO(): SocketIOServer {
        return this.io;
    }
}

const socketServer = SocketService.getInstance(); 
export default socketServer;