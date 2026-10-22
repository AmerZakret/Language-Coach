import type { NestExpressApplication } from '@nestjs/platform-express';
import { COMMUNITY_IMAGE_NAME, CommunityImageStorage } from './community-image.storage';

export function configureCommunityUploadServing(app: NestExpressApplication): void {
  const images = app.get(CommunityImageStorage);
  app.use('/uploads', async (req: any, res: any, next: () => void) => {
    const match = /^\/community\/([^/]+)$/.exec(req.path);
    if (!['GET', 'HEAD'].includes(req.method) || !match || !COMMUNITY_IMAGE_NAME.test(match[1])) return res.sendStatus(404);
    try { await images.assertServeable(`/uploads${req.path}`); }
    catch { return res.sendStatus(404); }
    next();
  });
  app.useStaticAssets(images.root, {
    prefix: '/uploads', index: false, dotfiles: 'deny',
    setHeaders: res => { res.setHeader('X-Content-Type-Options', 'nosniff'); },
  });
}
