import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { MembershipCache } from '../auth/membership-cache.service';
import type { AccessTokenPayload } from '../auth/types';

/**
 * Live updates (T7.2). A socket authenticates with the same access token as
 * the REST API and joins two rooms: its workspace and itself. Events carry
 * only *what changed* ({ type, id? }) — the client refetches through the
 * normal, authorised REST endpoints, so the socket never becomes a second
 * data path that needs its own permission checks.
 */
@WebSocketGateway({
  path: '/realtime',
  cors: {
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly memberships: MembershipCache,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth as { token?: unknown })?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      if (payload.type !== 'access') throw new Error('wrong token type');
      // same live-membership rule as the HTTP guard
      if (!(await this.memberships.role(payload.sub, payload.orgId))) {
        throw new Error('not a member');
      }
      await socket.join([`org:${payload.orgId}`, `user:${payload.sub}`]);
      socket.emit('ready', { orgId: payload.orgId });
    } catch (err) {
      this.logger.debug(`socket rejected: ${(err as Error).message}`);
      socket.emit('unauthorized');
      socket.disconnect(true);
    }
  }
}
