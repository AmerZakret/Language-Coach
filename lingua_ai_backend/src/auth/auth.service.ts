import { tryTargetLanguage } from '../common/target-language';
import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

const GUEST_EMAIL_SUFFIX = '@guest.lingua.local';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,  // User service for DB operations
    private readonly jwtService: JwtService,      // JWT service for token generation
  ) {}

  private isGuestEmail(email: string): boolean {
    return email.trim().toLowerCase().endsWith(GUEST_EMAIL_SUFFIX);
  }

  /**
   * User Registration:
   * 1. Checks if the email is already registered.
   * 2. Hashes the raw password securely using bcrypt (10 salt rounds).
   * 3. Creates the user in MongoDB.
   * 4. Signs a JWT token containing email and userId (sub) and returns access token + profile.
   */
  async register(name: string, email: string, password: string) {
    if (this.isGuestEmail(email)) {
      throw new BadRequestException('This email domain is reserved for guest sessions');
    }
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash the password securely before saving
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.usersService.create(name, email, passwordHash);

    // Create a payload for the JWT signing
    const payload = { email: user.email, sub: user._id.toString() };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        level: user.level,
        totalXp: user.totalXp,
        streak: user.streak,
        targetLanguage: tryTargetLanguage(user.targetLanguage) ?? user.targetLanguage ?? 'en',
      },
    };
  }

  /**
   * User Login:
   * 1. Looks up the user profile by email.
   * 2. Compares the submitted plain password against the stored bcrypt hash.
   * 3. Throws UnauthorizedException if credentials mismatch.
   * 4. Signs and returns a fresh JWT access token.
   */
  async login(email: string, password: string) {
    if (this.isGuestEmail(email)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const user = await this.usersService.findByEmail(email);
    if (!user || user.isGuest) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password match using bcrypt.compare
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { email: user.email, sub: user._id.toString() };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        level: user.level,
        totalXp: user.totalXp,
        streak: user.streak,
        targetLanguage: tryTargetLanguage(user.targetLanguage) ?? user.targetLanguage ?? 'en',
      },
    };
  }

  /**
   * Guest Login Session Isolation:
   * 1. Creates a unique guest account for this session.
   * 2. Signs a JWT token mapped to this user session.
   * 3. Returns a guest profile layout.
   */
  async guest() {
    const email = `guest-${randomUUID()}${GUEST_EMAIL_SUFFIX}`;
    // Deliberately not a bcrypt hash: guest accounts cannot use password login.
    const user = await this.usersService.create(
      'Guest User', email, '!guest-no-password!', true,
    );

    const payload = { email: user.email, sub: user._id.toString() };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        level: user.level,
        totalXp: user.totalXp,
        streak: user.streak,
        targetLanguage: tryTargetLanguage(user.targetLanguage) ?? user.targetLanguage ?? 'en',
        isGuest: true,
      },
    };
  }
}

