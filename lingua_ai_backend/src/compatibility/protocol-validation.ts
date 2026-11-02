import { BadRequestException } from '@nestjs/common';
import { ClientProtocolError } from './client-protocol.error';
import { CURRENT_CLIENT_PROTOCOL, ProtocolPolicy } from './protocol-contract';
import { isTimelineId } from '../operations/timeline-contract';

export interface TimelineHeaders {
  'x-client-protocol'?: string | string[];
  'x-data-timeline'?: string | string[];
}
export function mutationProtocol(
  headers: TimelineHeaders,
  policy: ProtocolPolicy,
  buildId = 'development',
): number {
  const raw = headers['x-client-protocol'];
  if (raw === undefined && policy === 'ENFORCE_MUTATIONS')
    throw new ClientProtocolError('CLIENT_PROTOCOL_REQUIRED', policy, buildId);
  const minimum = policy === 'ENFORCE_MUTATIONS' ? 2 : 1;
  if (
    raw !== undefined &&
    (typeof raw !== 'string' ||
      !/^[1-9]\d{0,5}$/.test(raw) ||
      Number(raw) < minimum ||
      Number(raw) > CURRENT_CLIENT_PROTOCOL)
  )
    throw new ClientProtocolError(
      'CLIENT_PROTOCOL_UNSUPPORTED',
      policy,
      buildId,
    );
  const timeline = headers['x-data-timeline'];
  if (timeline !== undefined && !isTimelineId(timeline))
    throw new BadRequestException({
      code: 'INVALID_DATA_TIMELINE',
      message: 'A canonical data timeline is required.',
    });
  return raw === undefined ? 1 : Number(raw);
}

export function validateDeclaredTimeline(headers: TimelineHeaders): void {
  const declared = headers['x-data-timeline'];
  if (declared !== undefined && !isTimelineId(declared))
    throw new BadRequestException({
      code: 'INVALID_DATA_TIMELINE',
      message: 'A canonical data timeline is required.',
    });
}
