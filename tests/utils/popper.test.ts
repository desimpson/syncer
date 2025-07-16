// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPopper } from "@/utils/popper";

// These tests use jsdom's layout approximations

const mockRect = (element: HTMLElement, rect: Partial<DOMRect>) => {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: rect.bottom ?? 100,
    left: rect.left ?? 50,
    width: rect.width ?? 200,
    top: rect.top ?? 0,
    right: rect.right ?? 0,
    height: rect.height ?? 0,
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    toJSON: () => ({}),
  } as DOMRect);
};

describe("createPopper", () => {
  const originalScrollY = globalThis.scrollY;
  const originalScrollX = globalThis.scrollX;

  beforeEach(() => {
    // jsdom doesn't calculate layout, so stub getBoundingClientRect
    window.scrollTo(0, 0);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "scrollY", { value: originalScrollY, configurable: true });
    Object.defineProperty(globalThis, "scrollX", { value: originalScrollX, configurable: true });
    vi.restoreAllMocks();
  });

  it("positions popper below reference and matches width", () => {
    const reference = document.createElement("input");
    const popper = document.createElement("div");
    document.body.append(reference, popper);

    mockRect(reference, { bottom: 120, left: 40, width: 300 });

    const { destroy } = createPopper(reference, popper);

    expect(popper.style.position).toBe("absolute");
    expect(popper.style.top).toBe(`${120 + window.scrollY}px`);
    expect(popper.style.left).toBe(`${40 + window.scrollX}px`);
    expect(popper.style.width).toBe("300px");

    destroy();
  });

  it("updates on resize/scroll and cleans up on destroy", () => {
    const reference = document.createElement("input");
    const popper = document.createElement("div");
    document.body.append(reference, popper);

    mockRect(reference, { bottom: 100, left: 10, width: 100 });

    const addEventListenerSpy = vi.spyOn(globalThis, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(globalThis, "removeEventListener");

    const { destroy } = createPopper(reference, popper);

    expect(addEventListenerSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(addEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    // simulate change
    mockRect(reference, { bottom: 300, left: 20, width: 150 });
    globalThis.dispatchEvent(new Event("resize"));

    expect(popper.style.top).toBe(`${300 + window.scrollY}px`);
    expect(popper.style.left).toBe(`${20 + window.scrollX}px`);
    expect(popper.style.width).toBe("150px");

    destroy();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
