import 'axios';
import type { DataTimeline } from '../utils/dataTimeline';

declare module 'axios' {
  interface AxiosRequestConfig {
    dataTimelineId?: string;
    timelineContext?: ReturnType<DataTimeline['context']>;
    clientProtocolRevision?: number | null;
  }
}
