import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/progress_service.dart';
import '../../services/sound_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../widgets/target_language_modal.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        LanguageService(),
        TargetLanguageService(),
        AuthService(),
        ProgressService(),
        SoundService()
      ]),
      builder: (context, child) {
        final lang = LanguageService();
        final targetLang = TargetLanguageService();
        final auth = AuthService();
        final progress = ProgressService();
        final sound = SoundService();

        return Scaffold(
          body: Stack(
            children: [
               Positioned(
                top: -50,
                left: -50,
                child: Container(
                  width: 250,
                  height: 250,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.primaryColor.withValues(alpha: 0.1),
                  ),
                ),
              ),
              SafeArea(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      _buildHeader(lang),
                      const SizedBox(height: 32),
                      _buildUserCard(auth, targetLang, lang),
                      const SizedBox(height: 24),
                      _buildStatsRow(progress, lang),
                      const SizedBox(height: 32),
                      _buildSettingsSection(context, lang, sound, targetLang, auth),
                    ],
                  ),
                ),
              ),
            ],
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 3),
        );
      },
    );
  }

  Widget _buildHeader(LanguageService lang) {
    return Text(
      lang.getString('profile'),
      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
    );
  }

  Widget _buildUserCard(AuthService auth, TargetLanguageService targetLang, LanguageService lang) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: AppTheme.premiumGradient,
        borderRadius: BorderRadius.circular(32),
        boxShadow: [
          BoxShadow(color: AppTheme.primaryColor.withValues(alpha: 0.3), blurRadius: 20, offset: const Offset(0, 10)),
        ],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 35,
            backgroundColor: Colors.white24,
            child: Text(
              auth.currentUserName.isNotEmpty ? auth.currentUserName[0].toUpperCase() : 'G',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white),
            ),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  auth.isGuest ? lang.getString('guest_user') : auth.currentUserName,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white),
                ),
                Text(
                  auth.currentUserEmail,
                  style: const TextStyle(fontSize: 14, color: Colors.white70, fontWeight: FontWeight.w500),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(12)),
                  child: Text(
                    '${targetLang.getLanguageFlag(targetLang.currentLanguage)} ${targetLang.getLanguageName(targetLang.currentLanguage)}',
                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow(ProgressService progress, LanguageService lang) {
    return Row(
      children: [
        Expanded(child: _buildMiniStat(lang.getString('xp'), '${progress.totalXp}', Icons.bolt_rounded, Colors.orange)),
        const SizedBox(width: 12),
        Expanded(child: _buildMiniStat(lang.getString('streak'), '${progress.streak}', Icons.local_fire_department_rounded, Colors.redAccent)),
        const SizedBox(width: 12),
        Expanded(child: _buildMiniStat(lang.getString('completed'), '${progress.completedLessonsCount}', Icons.check_circle_rounded, Colors.green)),
      ],
    );
  }

  Widget _buildMiniStat(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: AppTheme.glassShadow,
        border: Border.all(color: Colors.grey.shade100),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.textPrimary)),
          Text(label, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildSettingsSection(BuildContext context, LanguageService lang, SoundService sound, TargetLanguageService targetLang, AuthService auth) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle(lang.getString('settings')),
        const SizedBox(height: 16),
        _buildSettingTile(
          icon: Icons.language_rounded,
          title: lang.getString('interface_language'),
          trailing: DropdownButton<String>(
            value: lang.currentLanguage,
            underline: const SizedBox(),
            items: const [
              DropdownMenuItem(value: 'en', child: Text('English')),
              DropdownMenuItem(value: 'tr', child: Text('Türkçe')),
            ],
            onChanged: (v) => v != null ? lang.changeLanguage(v) : null,
          ),
        ),
        _buildSettingTile(
          icon: sound.isSoundEnabled ? Icons.volume_up_rounded : Icons.volume_off_rounded,
          title: lang.getString('sound_effects'),
          trailing: CupertinoSwitch(
            activeTrackColor: AppTheme.primaryColor,
            value: sound.isSoundEnabled,
            onChanged: (v) => sound.toggleSound(),
          ),
        ),
        _buildSettingTile(
          icon: Icons.translate_rounded,
          title: lang.getString('target_language'),
          onTap: () => showModalBottomSheet(
            context: context,
            backgroundColor: Colors.transparent,
            isScrollControlled: true,
            builder: (context) => const TargetLanguageModal(),
          ),
        ),
        const SizedBox(height: 32),
        _buildSettingTile(
          icon: Icons.logout_rounded,
          title: lang.getString('logout'),
          color: Colors.redAccent,
          onTap: () => auth.logout(),
        ),
      ],
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title.toUpperCase(),
      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppTheme.textSecondary, letterSpacing: 1.5),
    );
  }

  Widget _buildSettingTile({required IconData icon, required String title, Widget? trailing, VoidCallback? onTap, Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: AppTheme.glassShadow,
          border: Border.all(color: Colors.grey.shade100),
        ),
        child: ListTile(
          onTap: onTap,
          leading: Icon(icon, color: color ?? AppTheme.primaryColor),
          title: Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: color ?? AppTheme.textPrimary)),
          trailing: trailing ?? const Icon(Icons.chevron_right_rounded, color: AppTheme.textSecondary),
        ),
      ),
    );
  }
}
