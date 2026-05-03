import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    console.log('Registering user:', registerDto.email);
    return {
      message: 'User registered successfully (placeholder)',
      user: {
        name: registerDto.name,
        email: registerDto.email,
      },
    };
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    console.log('Logging in user:', loginDto.email);
    return {
      message: 'User logged in successfully (placeholder)',
      access_token: 'dummy-jwt-token',
    };
  }
}
