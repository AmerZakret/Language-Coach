import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/auth_api_service.dart';
import '../../services/progress_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final AuthApiService _apiService = AuthApiService();
  bool _isLoading = false;

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  Future<void> _handleLogin() async {
    final lang = LanguageService();
    final auth = AuthService();

    final email = _emailController.text.trim();
    final password = _passwordController.text.trim();

    // Local validation first
    final localError = auth.loginLocal(email, password);
    if (localError != null) {
      _showError(lang.getString(localError));
      return;
    }

    setState(() => _isLoading = true);

    try {
      final response = await _apiService.login(email, password);
      
      // Update session with backend data
      auth.setBackendSession(
        name: email.split('@')[0].toUpperCase(),
        email: email,
        token: response['access_token'] ?? '',
      );

      // Sync progress from backend
      await ProgressService().syncWithBackend();

      if (mounted) {
        Navigator.pushNamedAndRemoveUntil(context, AppRoutes.home, (route) => false);
      }
    } catch (e) {
      if (mounted) {
        _showError(e.toString().replaceAll('Exception: ', ''));
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _handleGuestLogin() {
    AuthService().loginAsGuest();
    Navigator.pushNamedAndRemoveUntil(context, AppRoutes.home, (route) => false);
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: LanguageService(),
      builder: (context, child) {
        final lang = LanguageService();
        return Scaffold(
          body: SafeArea(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Padding(
                padding: const EdgeInsets.all(AppTheme.standardPadding),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.topRight,
                      child: IconButton(
                        icon: const Icon(Icons.language, color: AppTheme.primaryColor),
                        onPressed: () {
                          lang.toggleLanguage();
                        },
                      ),
                    ),
                    const SizedBox(height: 32),
                    const Hero(
                      tag: 'logo',
                      child: Icon(
                        Icons.auto_awesome_rounded,
                        size: 80,
                        color: AppTheme.primaryColor,
                      ),
                    ),
                    const SizedBox(height: 32),
                    Text(
                      lang.getString('welcome_title'),
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w900,
                        color: AppTheme.textPrimaryColor,
                        letterSpacing: -1,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      lang.getString('welcome_subtitle'),
                      style: const TextStyle(
                        fontSize: 16,
                        color: AppTheme.textSecondaryColor,
                        fontWeight: FontWeight.w500,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 48),
                    CustomTextField(
                      controller: _emailController,
                      hintText: lang.getString('email'),
                      prefixIcon: Icons.email_rounded,
                    ),
                    const SizedBox(height: 16),
                    CustomTextField(
                      controller: _passwordController,
                      hintText: lang.getString('password'),
                      prefixIcon: Icons.lock_rounded,
                      isPassword: true,
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () {},
                        child: Text(
                          lang.getString('forgot_password'),
                          style: const TextStyle(
                            color: AppTheme.primaryColor,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    CustomButton(
                      text: lang.getString('login'),
                      onPressed: _isLoading ? null : () => _handleLogin(),
                      isLoading: _isLoading,
                    ),
                    const SizedBox(height: 16),
                    CustomButton(
                      text: lang.getString('continue_as_guest'),
                      onPressed: _handleGuestLogin,
                      isOutlined: true,
                    ),
                    const SizedBox(height: 32),

                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          lang.getString('no_account'),
                          style: const TextStyle(color: AppTheme.textSecondaryColor),
                        ),
                        TextButton(
                          onPressed: () {
                            Navigator.pushNamed(context, AppRoutes.register);
                          },
                          child: Text(
                            lang.getString('register'),
                            style: const TextStyle(
                              color: AppTheme.primaryColor,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
