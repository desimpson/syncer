const getBrowserWindow = (): Window | undefined =>
  typeof window === "undefined" ? undefined : window;

const getNodeGlobal = (): (typeof global & { fetch?: typeof fetch }) | undefined =>
  typeof global === "undefined" ? undefined : global;

export type RuntimeTimeoutHandle = number | NodeJS.Timeout;
export type RuntimeIntervalHandle = number | NodeJS.Timeout;

export const runtimeFetch: typeof fetch = (...arguments_) => {
  const browserWindow = getBrowserWindow();
  if (browserWindow !== undefined && typeof browserWindow.fetch === "function") {
    return browserWindow.fetch(...arguments_);
  }
  const nodeGlobal = getNodeGlobal();
  if (nodeGlobal !== undefined && typeof nodeGlobal.fetch === "function") {
    return nodeGlobal.fetch(...arguments_);
  }
  throw new Error("No fetch implementation available.");
};

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
  const nodeGlobal = getNodeGlobal();
  if (nodeGlobal !== undefined) {
    return nodeGlobal.setTimeout(handler, timeout, ...arguments_);
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
  const nodeGlobal = getNodeGlobal();
  if (nodeGlobal !== undefined) {
    nodeGlobal.clearTimeout(handle);
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
  const nodeGlobal = getNodeGlobal();
  if (nodeGlobal !== undefined) {
    return nodeGlobal.setInterval(handler, timeout, ...arguments_);
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
  const nodeGlobal = getNodeGlobal();
  if (nodeGlobal !== undefined) {
    nodeGlobal.clearInterval(handle);
  }
};
