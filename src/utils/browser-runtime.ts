const getBrowserWindow = (): Window | undefined =>
  typeof window === "undefined" ? undefined : window;

const getNodeSetTimeout = (): typeof setTimeout | undefined =>
  typeof setTimeout === "function" ? setTimeout : undefined;
const getNodeClearTimeout = (): typeof clearTimeout | undefined =>
  typeof clearTimeout === "function" ? clearTimeout : undefined;
const getNodeSetInterval = (): typeof setInterval | undefined =>
  typeof setInterval === "function" ? setInterval : undefined;
const getNodeClearInterval = (): typeof clearInterval | undefined =>
  typeof clearInterval === "function" ? clearInterval : undefined;

export type RuntimeTimeoutHandle = number | NodeJS.Timeout;
export type RuntimeIntervalHandle = number | NodeJS.Timeout;

export const runtimeOpen = (
  ...arguments_: Parameters<Window["open"]>
): Window | null | undefined => {
  const browserWindow = getBrowserWindow();
  if (browserWindow === undefined) {
    return undefined;
  }
  return browserWindow.open(...arguments_);
};

export const runtimeSetTimeout = (
  handler: (...arguments_: unknown[]) => void,
  timeout?: number,
  ...arguments_: readonly unknown[]
): RuntimeTimeoutHandle => {
  const browserWindow = getBrowserWindow();
  if (browserWindow !== undefined && typeof browserWindow.setTimeout === "function") {
    return browserWindow.setTimeout(handler, timeout, ...arguments_);
  }
  const nodeSetTimeout = getNodeSetTimeout();
  if (nodeSetTimeout !== undefined) {
    return nodeSetTimeout(handler, timeout, ...arguments_);
  }
  throw new Error("No setTimeout implementation available.");
};

export const runtimeClearTimeout = (handle: RuntimeTimeoutHandle | undefined): void => {
  const browserWindow = getBrowserWindow();
  if (
    browserWindow !== undefined &&
    typeof browserWindow.clearTimeout === "function" &&
    typeof handle === "number"
  ) {
    browserWindow.clearTimeout(handle);
    return;
  }
  const nodeClearTimeout = getNodeClearTimeout();
  if (nodeClearTimeout !== undefined) {
    nodeClearTimeout(handle);
  }
};

export const runtimeSetInterval = (
  handler: (...arguments_: unknown[]) => void,
  timeout?: number,
  ...arguments_: readonly unknown[]
): RuntimeIntervalHandle => {
  const browserWindow = getBrowserWindow();
  if (browserWindow !== undefined && typeof browserWindow.setInterval === "function") {
    return browserWindow.setInterval(handler, timeout, ...arguments_);
  }
  const nodeSetInterval = getNodeSetInterval();
  if (nodeSetInterval !== undefined) {
    return nodeSetInterval(handler, timeout, ...arguments_);
  }
  throw new Error("No setInterval implementation available.");
};

export const runtimeClearInterval = (handle: RuntimeIntervalHandle | undefined): void => {
  const browserWindow = getBrowserWindow();
  if (
    browserWindow !== undefined &&
    typeof browserWindow.clearInterval === "function" &&
    typeof handle === "number"
  ) {
    browserWindow.clearInterval(handle);
    return;
  }
  const nodeClearInterval = getNodeClearInterval();
  if (nodeClearInterval !== undefined) {
    nodeClearInterval(handle);
  }
};
