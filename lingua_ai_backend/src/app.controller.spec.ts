import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import request from 'supertest';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
  it('public health endpoint needs no auth or database and exposes only health status/time', async () => {
    const module = await Test.createTestingModule({ controllers: [AppController], providers: [AppService] }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body.status).toBe('ok');
      expect(Object.keys(response.body).sort()).toEqual(['status', 'timestamp']);
      expect(Number.isFinite(Date.parse(response.body.timestamp))).toBe(true);
    } finally { await app.close(); }
  });

});
