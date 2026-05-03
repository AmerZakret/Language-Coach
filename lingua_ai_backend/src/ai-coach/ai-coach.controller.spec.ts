import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachController } from './ai-coach.controller';

describe('AiCoachController', () => {
  let controller: AiCoachController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiCoachController],
    }).compile();

    controller = module.get<AiCoachController>(AiCoachController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
