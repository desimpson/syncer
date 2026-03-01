/**
 * A lightweight [Popper](https://popper.js.org/docs/) implementation to
 * position an element relative to another.
 */
export type Popper = {
  destroy: () => void;
};

/**
 * Positions an element (`popperElement`) relative to a reference element
 * (`referenceElement`), keeps its width matched, and updates on scroll/resize.
 *
 * @param referenceElement - The element to position against (input)
 * @param popperElement - The element to position (suggestion dropdown)
 * @returns A PopperInstance with a destroy method
 */
export function createPopper(referenceElement: HTMLElement, popperElement: HTMLElement): Popper {
  popperElement.classList.add("syncer-popper");
  const updatePosition = () => {
    const rect = referenceElement.getBoundingClientRect();
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment -- dynamic positioning requires inline styles
    popperElement.style.position = "absolute";
    popperElement.style.top = `${rect.bottom + window.scrollY}px`;
    popperElement.style.left = `${rect.left + window.scrollX}px`;
    popperElement.style.width = `${rect.width}px`;
  };

  // Initial positioning
  updatePosition();

  // Update on scroll and resize
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);

  return {
    destroy: () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    },
  };
}
