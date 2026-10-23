import { AsyncLocalStorage } from 'node:async_hooks';

export const emailDeliveryContext = new AsyncLocalStorage<{
  jobId: string;
  taskId?: string;
  sequence: number;
}>();
