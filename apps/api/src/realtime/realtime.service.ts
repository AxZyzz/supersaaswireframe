import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/** What changed — clients refetch the matching REST resource. */
export type RealtimeTopic = 'inbox' | 'notifications' | 'campaigns' | 'team';

export interface RealtimeEvent {
  type: RealtimeTopic;
  id?: string;
}

/**
 * Fire-and-forget fan-out. Call it AFTER the transaction commits, so a client
 * that refetches immediately sees the change. With the Redis adapter (main.ts)
 * events reach sockets on every API instance.
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  toOrg(orgId: string, event: RealtimeEvent) {
    this.gateway.server?.to(`org:${orgId}`).emit('change', event);
  }

  toUser(userId: string, event: RealtimeEvent) {
    this.gateway.server?.to(`user:${userId}`).emit('change', event);
  }
}
