export const isMainThread = true;
export const parentPort = null;
export const threadId = 0;
export const workerData = null;

export class Worker {
  constructor() {}
  postMessage() {}
  terminate() {}
  on() {}
  off() {}
  once() {}
}

export default { isMainThread, parentPort, Worker, threadId, workerData };
