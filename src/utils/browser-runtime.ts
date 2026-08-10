const getBrowserWindow = (): Window | undefined =>
  typeof window === "undefined" ? undefined : window;

export type RuntimeTimeoutHandle = number | ReturnType<typeof globalThis.setTimeout>;
export type RuntimeIntervalHandle = number | ReturnType<typeof globalThis.setInterval>;

export const runtimeFetch: typeof fetch = (...arguments_) => {
  const browserWindow = getBrowserWindow();
  if (browserWindow !== undefined && typeof browserWindow.fetch === "function") {
    return browserWindow.fetch(...arguments_);
  }
  return globalThis.fetch(...arguments_);
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
  return globalThis.setTimeout(handler, timeout, ...arguments_);
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
  globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout> | undefined);
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
  return globalThis.setInterval(handler, timeout, ...arguments_);
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
  globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval> | undefined);
};
