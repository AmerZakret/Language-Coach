import { Body, Controller, Get, Patch, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@Req() req: any) {
    const user = req.user;
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      level: user.level,
      totalXp: user.totalXp,
      streak: user.streak,
      targetLanguage: user.targetLanguage || 'English',
    };
  }

  @Patch('profile')
  async updateProfile(
    @Req() req: any,
    @Body() body: { name?: string; targetLanguage?: string },
  ) {
    const userId = req.user._id.toString();
    const updatedUser = await this.usersService.updateProfile(
      userId,
      body.name,
      body.targetLanguage,
    );
    if (!updatedUser) {
      throw new NotFoundException('User profile not found');
    }
    return {
      id: updatedUser._id.toString(),
      name: updatedUser.name,
      email: updatedUser.email,
      level: updatedUser.level,
      totalXp: updatedUser.totalXp,
      streak: updatedUser.streak,
      targetLanguage: updatedUser.targetLanguage || 'English',
    };
  }
}
