import { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { query } from './db';
import { User } from './types';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const google = new OAuth2Client(config.googleClientId);

// Verifies the Google ID token from the frontend and issues our own session token.
export async function loginWithGoogle(credential: string): Promise<{ token: string; user: User }> {
  const ticket = await google.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new Error('Invalid Google credential');

  const user: User = {
    id: payload.sub,
    name: payload.name ?? payload.email,
    email: payload.email,
    avatar: payload.picture ?? '',
  };

  await query(
    `INSERT INTO users (id, name, email, avatar) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = $2, email = $3, avatar = $4`,
    [user.id, user.name, user.email, user.avatar],
  );

  return { token: jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' }), user };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  try {
    req.userId = (jwt.verify(token, config.jwtSecret) as { sub: string }).sub;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export const signState = (userId: string) =>
  jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '10m' });

export const verifyState = (state: string) =>
  (jwt.verify(state, config.jwtSecret) as { sub: string }).sub;
