import * as bcrypt from 'bcryptjs';
import * as jose from 'jose';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { UnauthorizedError, ConflictError, ValidationError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { getConfig } from '@/lib/config';
import type { RegisterDto, LoginDto } from '@/validators/auth.validator';
import type { User } from '@prisma/client';

/** bcrypt cost for new hashes. Existing cost-10 hashes still verify and upgrade on the next password change. */
export const SALT_ROUNDS = 12;

/** How long an admin's "view as user" session lasts. Deliberately short. */
export const IMPERSONATION_TTL_SECONDS = 30 * 60;

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
  /** Set on a "view as user" token: the admin viewing. */
  impersonatorId?: string;
  /** The admin's `tokenVersion` at issue time, so signing them out everywhere ends the view too. */
  impersonatorTokenVersion?: number;
  iat: number;
  exp: number;
}

/** The authenticated user, read fresh from the database. */
export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
  /** Set while an admin views the dashboard as this user; the session is then read-only. */
  impersonatorId?: string;
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
      const impersonatorId = typeof payload.imp === 'string' ? payload.imp : undefined;
      const impersonatorTokenVersion = typeof payload.itv === 'number' ? payload.itv : undefined;
      if (!sub || !email) {
        throw new UnauthorizedError('Invalid token payload');
      }
      return {
        sub,
        email,
        role,
        mustResetPassword,
        tokenVersion,
        impersonatorId,
        impersonatorTokenVersion,
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
    if (payload.impersonatorId) {
      const admin = await this.userRepo.findById(payload.impersonatorId);
      // The view ends the moment the admin loses the role or signs out everywhere, or the user becomes an admin.
      if (
        !admin ||
        admin.role !== 'CONTRIBUTOR' ||
        admin.tokenVersion !== payload.impersonatorTokenVersion ||
        user.role === 'CONTRIBUTOR'
      ) {
        throw new UnauthorizedError('Session has been revoked');
      }
      // Every write is refused while viewing, so the user's pending reset must not trap the admin on that page.
      return { userId: user.id, email: user.email, role: user.role, mustResetPassword: false, impersonatorId: admin.id };
    }
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
    };
  }

  /**
   * A short "view as user" session for an admin: the user's identity plus the
   * admin's id. Every request on it is read-only (see `impersonationBlockReason`).
   * Admins can never view as another admin, or as themselves.
   */
  async impersonate(adminId: string, targetId: string): Promise<{ accessToken: string; target: { id: string; email: string } }> {
    if (adminId === targetId) throw new ValidationError('You cannot view as yourself');
    const [admin, target] = await Promise.all([this.userRepo.findById(adminId), this.userRepo.findById(targetId)]);
    if (!admin || admin.role !== 'CONTRIBUTOR') throw new ForbiddenError('Contributor access required');
    if (!target) throw new NotFoundError('User');
    if (target.role === 'CONTRIBUTOR') throw new ForbiddenError('You cannot view as another admin');
    const accessToken = await this.sign(
      {
        sub: target.id,
        email: target.email,
        role: target.role,
        mustResetPassword: false,
        tv: target.tokenVersion,
        imp: admin.id,
        itv: admin.tokenVersion,
      },
      `${IMPERSONATION_TTL_SECONDS}s`,
    );
    return { accessToken, target: { id: target.id, email: target.email } };
  }

  private async issueTokens(user: Pick<User, 'id' | 'email' | 'role' | 'mustResetPassword' | 'tokenVersion'>): Promise<AuthTokens> {
    const token = await this.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        mustResetPassword: user.mustResetPassword,
        tv: user.tokenVersion,
      },
      this.config.jwtExpiresIn,
    );
    return { accessToken: token, expiresIn: this.config.jwtExpiresIn };
  }

  private async sign(claims: jose.JWTPayload, expiresIn: string): Promise<string> {
    if (!this.config.jwtSecret) {
      throw new ValidationError('JWT_SECRET not configured');
    }
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(new TextEncoder().encode(this.config.jwtSecret));
  }
}

export const authService = new AuthService(userRepository, {
  jwtSecret: getConfig().JWT_SECRET ?? '',
  jwtExpiresIn: getConfig().JWT_EXPIRES_IN,
});
