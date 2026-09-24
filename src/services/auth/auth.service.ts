import * as bcrypt from 'bcryptjs';
import * as jose from 'jose';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { UnauthorizedError, ConflictError, ValidationError } from '@/lib/errors';
import { getConfig } from '@/lib/config';
import type { RegisterDto, LoginDto } from '@/validators/auth.validator';
import type { User } from '@prisma/client';

const SALT_ROUNDS = 10;

export interface AuthTokens {
  accessToken: string;
  expiresIn: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
  /** `User.tokenVersion` at issue time. Absent on tokens issued before revocation existed. */
  tokenVersion: number;
  iat: number;
  exp: number;
}

/** The authenticated user, read fresh from the database. */
export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
}

export interface AuthServiceConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export class AuthService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly config: AuthServiceConfig
  ) {}

  /**
   * Registers a new user. Throws if email already exists.
   */
  async register(dto: RegisterDto): Promise<{ userId: string; tokens: AuthTokens }> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) {
      throw new ConflictError('Email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.userRepo.create({ email: dto.email, passwordHash });
    const tokens = await this.issueTokens(user);
    return { userId: user.id, tokens };
  }

  /**
   * Authenticates user and returns tokens.
   */
  async login(dto: LoginDto): Promise<{ userId: string; tokens: AuthTokens }> {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const tokens = await this.issueTokens(user);
    return { userId: user.id, tokens };
  }

  /**
   * Resets the user's password and returns fresh tokens with mustResetPassword: false.
   */
  async resetPassword(userId: string, newPassword: string): Promise<AuthTokens> {
    if (newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }
    // Revokes every other session; the caller gets a fresh token for this one.
    const updated = await this.userRepo.setPassword(userId, hash);
    return this.issueTokens(updated);
  }

  /**
   * Changes a signed-in user's password. Unlike {@link resetPassword} this
   * requires the current one, so a session alone — which a forged cross-site
   * request carries — is not enough to take over the account.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthTokens> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new ValidationError('Current password is incorrect');
    }
    return this.resetPassword(userId, newPassword);
  }

  /**
   * Verifies JWT and returns payload. Throws UnauthorizedError if invalid.
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    if (!this.config.jwtSecret) {
      throw new ValidationError('JWT_SECRET not configured');
    }
    try {
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(this.config.jwtSecret),
        { algorithms: ['HS256'] }
      );
      const sub = payload.sub as string;
      const email = payload.email as string;
      const role = (payload.role as string) ?? 'USER';
      const mustResetPassword = (payload.mustResetPassword as boolean) ?? false;
      const tokenVersion = typeof payload.tv === 'number' ? payload.tv : 0;
      if (!sub || !email) {
        throw new UnauthorizedError('Invalid token payload');
      }
      return {
        sub,
        email,
        role,
        mustResetPassword,
        tokenVersion,
        iat: (payload.iat as number) ?? 0,
        exp: (payload.exp as number) ?? 0,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  /**
   * Verifies a token *and* that it has not been revoked, returning the user as
   * the database has them now. Use this, not {@link verifyToken}, for anything
   * that authorises a request: the JWT alone would keep a deleted user, a
   * demoted admin or a stolen token working until it expires.
   */
  async verifySession(token: string): Promise<SessionUser> {
    const payload = await this.verifyToken(token);
    const user = await this.userRepo.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedError('Session has been revoked');
    }
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
    };
  }

  private async issueTokens(user: Pick<User, 'id' | 'email' | 'role' | 'mustResetPassword' | 'tokenVersion'>): Promise<AuthTokens> {
    if (!this.config.jwtSecret) {
      throw new ValidationError('JWT_SECRET not configured');
    }
    const token = await new jose.SignJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
      tv: user.tokenVersion,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.config.jwtExpiresIn)
      .sign(new TextEncoder().encode(this.config.jwtSecret));
    return { accessToken: token, expiresIn: this.config.jwtExpiresIn };
  }
}

export const authService = new AuthService(userRepository, {
  jwtSecret: getConfig().JWT_SECRET ?? '',
  jwtExpiresIn: getConfig().JWT_EXPIRES_IN,
});
