export type Role = 'admin' | 'manager' | 'agent';

/** Attached to req.user by JwtAuthGuard after access-token verification. */
export interface AuthUser {
  userId: string;
  orgId: string;
  role: Role;
}

export interface AccessTokenPayload {
  sub: string;
  orgId: string;
  role: Role;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // refresh_tokens.id
  type: 'refresh';
  org?: string; // workspace active when issued; refresh keeps it
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
