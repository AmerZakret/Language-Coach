import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import type { ServerResponse } from 'node:http';
import {
  COMMUNITY_IMAGE_NAME,
  CommunityImageStorage,
} from './community-image.storage';

export function configureCommunityUploadServing(
  app: NestExpressApplication,
): void {
  const images = app.get(CommunityImageStorage);
  if (images.shared()) return; // JWT-protected exact-reference Nest route; never static/S3 fallback.
  app.use(
    '/uploads',
    async (req: Request, res: Response, next: NextFunction) => {
      const match = /^\/community\/([^/]+)$/.exec(req.path);
      if (
        !['GET', 'HEAD'].includes(req.method) ||
        !match ||
        !COMMUNITY_IMAGE_NAME.test(match[1])
      )
        return res.sendStatus(404);
      try {
        await images.assertServeable(`/uploads${req.path}`);
      } catch {
        return res.sendStatus(404);
      }
      next();
    },
  );
  app.useStaticAssets(images.root, {
    prefix: '/uploads',
    index: false,
    dotfiles: 'deny',
    setHeaders: (res: ServerResponse) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });
}
