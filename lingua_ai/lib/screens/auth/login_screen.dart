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
        backgroundColor: AppTheme.errorColor,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
      
      final userData = response['user'] ?? {};
      // Update session with backend data
      auth.setBackendSession(
        name: userData['name'] ?? email.split('@')[0].toUpperCase(),
        email: userData['email'] ?? email,
        token: response['access_token'] ?? '',
        id: userData['id'] ?? '',
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

  Future<void> _handleGuestLogin() async {
    setState(() => _isLoading = true);
    final auth = AuthService();

    try {
      final response = await _apiService.loginGuest();
      final userData = response['user'] ?? {};
      auth.setGuestSession(
        token: response['access_token'] ?? '',
        id: userData['id'] ?? 'guest',
      );
    } catch (e) {
      // Server unreachable — fall back to local guest mode
      debugPrint('Guest login backend failed, falling back to local: $e');
      auth.loginAsGuest();
    }

    if (mounted) {
      setState(() => _isLoading = false);
      Navigator.pushNamedAndRemoveUntil(context, AppRoutes.home, (route) => false);
    }
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
          body: Container(
            decoration: const BoxDecoration(
              gradient: AppTheme.backgroundGradient,
            ),
            child: SafeArea(
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Language switch
                      Align(
                        alignment: Alignment.topRight,
                        child: Container(
                          margin: const EdgeInsets.only(top: 8),
                          decoration: BoxDecoration(
                            color: AppTheme.primaryColor.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: IconButton(
                            icon: const Icon(Icons.translate_rounded, color: AppTheme.primaryColor, size: 22),
                            onPressed: () => lang.toggleLanguage(),
                          ),
                        ),
                      ),

                      const SizedBox(height: 24),

                      // Logo
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                            boxShadow: AppTheme.softShadow,
                          ),
                          child: Image.asset(
                            'assets/images/language-learning.png',
                            width: 80,
                            height: 80,
                          ),
                        ),
                      ),
                      const SizedBox(height: 28),

                      // Title
                      Text(
                        lang.getString('welcome_title'),
                        style: const TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.w900,
                          color: AppTheme.textPrimaryColor,
                          letterSpacing: -1,
                          height: 1.2,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        lang.getString('welcome_subtitle'),
                        style: const TextStyle(
                          fontSize: 15,
                          color: AppTheme.textSecondaryColor,
                          fontWeight: FontWeight.w500,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 40),

                      // Fields
                      CustomTextField(
                        controller: _emailController,
                        hintText: lang.getString('email'),
                        prefixIcon: Icons.email_outlined,
                      ),
                      const SizedBox(height: 14),
                      CustomTextField(
                        controller: _passwordController,
                        hintText: lang.getString('password'),
                        prefixIcon: Icons.lock_outline_rounded,
                        isPassword: true,
                      ),
                      const SizedBox(height: 4),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () {},
                          child: Text(
                            lang.getString('forgot_password'),
                            style: TextStyle(
                              color: AppTheme.primaryColor.withValues(alpha: 0.8),
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Buttons
                      CustomButton(
                        text: lang.getString('login'),
                        onPressed: _isLoading ? null : () => _handleLogin(),
                        isLoading: _isLoading,
                      ),
                      const SizedBox(height: 12),
                      CustomButton(
                        text: lang.getString('continue_as_guest'),
                        onPressed: _handleGuestLogin,
                        isOutlined: true,
                      ),
                      const SizedBox(height: 28),

                      // Register link
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            lang.getString('no_account'),
                            style: const TextStyle(color: AppTheme.textSecondaryColor, fontSize: 14),
                          ),
                          TextButton(
                            onPressed: () => Navigator.pushNamed(context, AppRoutes.register),
                            child: Text(
                              lang.getString('register'),
                              style: const TextStyle(
                                color: AppTheme.primaryColor,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
