import { serializeUser } from './user-response';
import { Body, Controller, Get, Patch, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@Req() req: any) {
    const user = req.user;
    return serializeUser(user);
  }

  @Patch('profile')
  async updateProfile(
    @Req() req: any,
    @Body() body: UpdateProfileDto,
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
    return serializeUser(updatedUser);
  }
}
