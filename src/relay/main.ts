import { WebSocketServer } from 'ws';
import { log } from '@/shared/log';

const port = +(process.env.RELAY_PORT as `${number}`);

const wss = new WebSocketServer({ port, path: '/' });

wss.on('connection', () => {
	log('info', 'relay got a new connection');
});

wss.on('listening', () => {
	log('info', `relay is listening on ws://localhost:${port}/`);
});

wss.on('error', (err) => {
	log('error', 'relay error:', err);
});
