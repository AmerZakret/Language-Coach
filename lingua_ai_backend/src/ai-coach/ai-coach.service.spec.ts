import { Test, TestingModule } from '@nestjs/testing';
import { AiCoachService } from './ai-coach.service';

describe('AiCoachService', () => {
  let service: AiCoachService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiCoachService],
    }).compile();

    service = module.get<AiCoachService>(AiCoachService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
